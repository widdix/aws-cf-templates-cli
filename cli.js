'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const console = require('console');
const AWS = require('aws-sdk');
const requestretry = require('requestretry');
const docopt = require('docopt');
const semver = require('semver');
const proxy = require('proxy-agent');
const truncate = require('truncate-middle');
const md5 = require('md5');

const graphlib = require('./lib/graph.js');
const tablelib = require('./lib/table.js');
const loglib = require('./lib/log.js');
const awscredslib = require('./lib/aws-credentials.js');

const generateAwsConfig = (account, configOverrides) => {
  return Object.assign({}, account.config, configOverrides);
};

const fetchTemplateSummary = (account, url) => {
  const cloudformation = new AWS.CloudFormation(generateAwsConfig(account, {apiVersion: '2010-05-15'}));
  return cloudformation.getTemplateSummary({
    TemplateURL: url
  }).promise();
};

const detectTemplateDrift = async (account, stackRegion, stackName, templateId, templateVersion) => {
  const cloudformation = new AWS.CloudFormation(generateAwsConfig(account, {
    apiVersion: '2010-05-15',
    region: stackRegion
  }));
  if (templateVersion === undefined) {
    return undefined;
  } else {
    const rawTemplate = await downloadS3File('widdix-aws-cf-templates-releases-eu-west-1', `v${templateVersion}/${templateId}.yaml`);
    const liveTemplate = await cloudformation.getTemplate({
      StackName: stackName
    }).promise();
    // CloudFormation replaces non-ascii chars with ? 
    const rawMd5 = md5(rawTemplate.replace(/[^\x00-\x7F]/g, '?')); // eslint-disable-line no-control-regex 
    const liveMd5 = md5(liveTemplate.TemplateBody);
    return rawMd5 !== liveMd5;
  }
};

const downloadFileCache = new Map();
const downloadS3File = async (bucket, key) => {
  const url = `s3://${bucket}/${key}`;
  if (downloadFileCache.has(url)) {
    return downloadFileCache.get(url);
  }
  const s3 = new AWS.S3({apiVersion: '2006-03-01'});
  const p = s3.makeUnauthenticatedRequest('getObject', {
    Bucket: bucket,
    Key: key
  }).promise()
    .then(data => data.Body.toString('utf8'));
  downloadFileCache.set(url, p);
  return p;
};
const downloadFile = (url) => { // includes caching
  if (downloadFileCache.has(url)) {
    return downloadFileCache.get(url);
  }
  const p = new Promise((resolve, reject) => {
    requestretry({
      method: 'GET',
      url,
      maxAttempts: 5,
      retryDelay: 1000
    }, (err, res, body) => {
      if (err) {
        reject(err);
      } else {
        if (res.statusCode === 200) {
          resolve(body);
        } else {
          reject(new Error(`${url} 200 expected, received ${res.statusCode}: ${body}`));
        }
      }
    });
  });
  downloadFileCache.set(url, p);
  return p;
};

const fetchLatestTemplateVersion = async (input) => {
  if (input['--latest-version'] !== null) {
    return input['--latest-version'];
  }
  const body = await downloadFile('https://github.com/widdix/aws-cf-templates/releases.atom');
  return body.match(/<title>(v[0-9.]*)<\/title>/i)[1].replace('v', '');
};

const extractTemplateIDFromStack = (stack) => {
  const templateId = stack.Outputs.find((output) => output.OutputKey === 'TemplateID').OutputValue;
  if (templateId === undefined) {
    loglib.warning(`can not extract template id in ${stack.Region} for stack ${stack.StackName}`, stack);
  }
  return templateId;
};

const extractTemplateVersionFromStack = (templateId, stack) => {
  const output = stack.Outputs.find((output) => output.OutputKey === 'TemplateVersion');
  if (output === undefined || output.OutputValue === '__VERSION__') {
    loglib.warning(`can not extract template version in ${stack.Region} for stack ${stack.StackName} (${templateId})`, stack);
    return undefined;
  }
  return output.OutputValue;
};

const extractParentStacksFromParameters = (parameters) => {
  return Object.keys(parameters)
    .filter(key => key.startsWith('Parent'))
    .filter(key => parameters[key] !== '')
    .map(key => ({
      parameterName: key,
      stackName: parameters[key]
    }));
};

const fetchStacks = (account, region) => {
  const fetch = (previousStacks, nextToken) => {
    const cloudformation = new AWS.CloudFormation(generateAwsConfig(account, {
      apiVersion: '2010-05-15',
      region: region
    }));
    return cloudformation.describeStacks({
      NextToken: nextToken
    }).promise()
      .then((data) => {
        const stacks = [...previousStacks, ...data.Stacks.map(stack => Object.assign({}, stack, {Region: region}))];
        if (data.NextToken !== null && data.NextToken !== undefined) {
          return fetch(stacks, data.NextToken);
        } else {
          return stacks;
        }
      });
  };
  return fetch([], null);
};

const fetchRegions = (account, region) => {
  if (region !== null) {
    return Promise.resolve([region]);
  } else {
    const ec2 = new AWS.EC2(generateAwsConfig(account, {apiVersion: '2016-11-15'}));
    return ec2.describeRegions({}).promise()
      .then(data => data.Regions.map(region => region.RegionName));
  }
};

const enrichStack = async (account, stack, input) => {
  const templateId = extractTemplateIDFromStack(stack);
  const templateVersion = extractTemplateVersionFromStack(templateId, stack);
  const parameters = stack.Parameters.reduce((acc, parameter) => {
    acc[parameter.ParameterKey] = parameter.ParameterValue;
    return acc;
  }, {});
  const parentStacks =  extractParentStacksFromParameters(parameters);
  const isUpdateAvailable = (latestVersion, templateVersion) => {
    if (templateVersion === undefined) { // unreleased version, from git repo directly
      return undefined;
    }
    try {
      return semver.gt(latestVersion, templateVersion);
    } catch (e) {
      loglib.warning(`can not compare latest template version (v${latestVersion}) in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
      return undefined;
    }    
  };
  const latestVersion = await fetchLatestTemplateVersion(input).catch(e => {
    loglib.warning(`can not get latest template version in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
    return undefined;
  });
  const templateDrift = await detectTemplateDrift(account, stack.Region, stack.StackName, templateId, templateVersion).catch(e => {
    loglib.warning(`can not get detect template drift in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
    return undefined;
  });
  return {
    account,
    region: stack.Region,
    name: stack.StackName,
    parameters,
    parentStacks,
    templateId,
    templateVersion,
    templateDrift,
    templateLatestVersion: latestVersion,
    templateUpdateAvailable: isUpdateAvailable(latestVersion, templateVersion)
  };
};

const fetchAllStacks = (account, input) => {
  return fetchRegions(account, input['--region'])
    .then(regions => Promise.all(regions.map(region => fetchStacks(account, region))))
    .then(stackLists => {
      return Promise.all(
        stackLists
          .reduce((acc, stacks) => [...acc, ...stacks], [])
          .filter((stack) => {
            return stack.Outputs.some((output) => (output.OutputKey === 'TemplateID' && output.OutputValue.includes('/')));
          })
          .map((stack) => {
            return enrichStack(account, stack, input);
          })
      );
    });
};

const yes = (stdconsole, stdin, question, alwaysYes) => {
  if (alwaysYes === true) {
    return Promise.resolve();
  } else {
    return new Promise((resolve, reject) => {
      stdin.once('data', b => {
        const answer = b.toString('utf8').replace(/[^a-z]/gi, '').toLowerCase();
        if (answer === 'y' || answer === 'yes') {
          resolve();
        } else {
          reject(new Error('abort'));
        }
      });
      stdconsole.info(`${question} [y/N]`);
    });
  }
};

const createChangeSet = async (stack) => {
  const cloudformation = new AWS.CloudFormation(generateAwsConfig(stack.account, {
    apiVersion: '2010-05-15',
    region: stack.region
  }));
  const changeSetName = `widdix-${crypto.randomBytes(16).toString('hex')}`;
  const templateURL = `https://s3-eu-west-1.amazonaws.com/widdix-aws-cf-templates-releases-eu-west-1/v${stack.templateLatestVersion}/${stack.templateId}.yaml`;
  const template = await fetchTemplateSummary(stack.account, templateURL);
  const parameters = template.Parameters.reduce((acc, parameter) => {
    acc[parameter.ParameterKey] = {
      default: parameter.DefaultValue,
      previous: stack.parameters[parameter.ParameterKey]
    };
    return acc;
  }, {});
  await cloudformation.createChangeSet({
    ChangeSetName: changeSetName,
    StackName: stack.name,
    ChangeSetType: 'UPDATE',
    Description: `widdix-v${require('./package.json').version}`,
    Parameters: Object.keys(parameters).map(key => {
      const parameter = parameters[key];
      const ret ={
        ParameterKey: key,
      };
      if (parameter.previous !== undefined) { // existing parameter
        ret.UsePreviousValue = true;
      } else if (parameter.default !== undefined) { // new parameter with default
        ret.ParameterValue = parameter.default;
      } else { // new parameter without default
        throw new Error('not yet implemented: update contains new parameter (without default)'); // TODO implement
      }
      return ret;
    }),
    TemplateURL: templateURL,
    Capabilities: ['CAPABILITY_IAM']
  }).promise();
  const data = await cloudformation.waitFor('changeSetCreateComplete', {
    StackName: stack.name,
    ChangeSetName: changeSetName
  }).promise();
  return {
    name: data.ChangeSetName,
    changes: data.Changes.map(change => ({
      action: change.ResourceChange.Action,
      actionModifyReplacement: change.ResourceChange.Replacement,
      resource: {
        type: change.ResourceChange.ResourceType,
        id: change.ResourceChange.PhysicalResourceId
      }
    }))
  };
};

const timeout = async (ms) => new Promise(resolve => setTimeout(resolve, ms));

const tailStackEvents = async (stack, changeSetType, eventCallback) => {
  const cloudformation = new AWS.CloudFormation(generateAwsConfig(stack.account, {
    apiVersion: '2010-05-15',
    region: stack.region
  }));
  const publishedEventIds = new Set();
  const publishEvent = (event) => {
    publishedEventIds.add(event.EventId);
    eventCallback(event);
  };
  const fetchAll = async (nextToken) => {
    const data = await cloudformation.describeStackEvents({
      StackName: stack.name,
      NextToken: nextToken
    }).promise();
    if (data.NextToken !== undefined) {
      return [...data.StackEvents, ...await fetchAll(data.NextToken)];
    }
    return data.StackEvents;
  };
  const ts = Date.now() + (60 * 60 * 1000); // TODO make timeout of 1 hour configurable
  while(Date.now() < ts) {
    await timeout(1000);
    const allEvents = await fetchAll();
    const startEventIdx = allEvents.findIndex((event) => event.ResourceStatus === `${changeSetType}_IN_PROGRESS` && event.ResourceType === 'AWS::CloudFormation::Stack');
    if (startEventIdx === -1) {
      continue;
    }
    const events = allEvents.slice(0, startEventIdx+1);
    const endEventIdx = events.findIndex((event) => event.ResourceStatus === `${changeSetType}_COMPLETE` && event.ResourceType === 'AWS::CloudFormation::Stack');
    const relevantEvents = events.slice((endEventIdx === -1) ? 0 : endEventIdx).reverse();
    relevantEvents
      .filter((event) => !publishedEventIds.has(event.EventId))
      .forEach(publishEvent);
    if (endEventIdx === -1) {
      const mostRecentEvent = relevantEvents[relevantEvents.length-1];
      if (mostRecentEvent.ResourceStatus === `${changeSetType}_FAILED` && mostRecentEvent.ResourceType === 'AWS::CloudFormation::Stack') { // failure
        throw new Error(`stack ${changeSetType.toLowerCase()} failed`);
      } else {
        continue;
      }
    } else {
      return relevantEvents;
    }
  }
  throw Error(`stack ${changeSetType.toLowerCase()} timed out`);
};

const executeChangeSet = async (stack, changeSet, eventCallback) => {
  const cloudformation = new AWS.CloudFormation(generateAwsConfig(stack.account, {
    apiVersion: '2010-05-15',
    region: stack.region
  }));
  await cloudformation.executeChangeSet({
    ChangeSetName: changeSet.name,
    StackName: stack.name
  }).promise();
  await tailStackEvents(stack, 'UPDATE', eventCallback);
};

const token = (stdconsole, stdin, question) => {
  return new Promise((resolve, reject) => {
    stdin.once('data', b => {
      const answer = b.toString('utf8').replace(/[^0-9]/gi, '');
      if (answer.length !== 6) {
        reject(new Error('a token must have 6 digits'));
      } else {
        resolve(answer);
      }
    });
    stdconsole.error(question);
  });
};

const sessionTokenCredentialsCache = new Map();
const createSessionTokenCredentials = async (stdconsole, stdin, masterCredentials, serialNumber) => {
  if (sessionTokenCredentialsCache.has(serialNumber)) {
    return sessionTokenCredentialsCache.get(serialNumber);
  } else {
    const code = await token(stdconsole, stdin, `Please enter the MFA token for ${serialNumber}`);
    const credentials = new AWS.TemporaryCredentials({
      DurationSeconds: 60 * 60 * 12,
      SerialNumber: serialNumber,
      TokenCode: code
    }, masterCredentials);
    await credentials.getPromise(); // TODO could be cached on disk to avoid entering the mfa token every time
    delete credentials.masterCredentials; // otherwise the aws sdk uses the original masterCredentaisl for assume role instead of the session token
    sessionTokenCredentialsCache.set(serialNumber, credentials);
    return credentials;
  }
};

const enrichAwsAccount = async (account) => {
  const iam = new AWS.IAM(generateAwsConfig(account, {apiVersion: '2010-05-08'}));
  const sts = new AWS.STS(generateAwsConfig(account, {apiVersion: '2011-06-15'}));
  let accountId = null;
  let accountAlias = null;
  try {
    const callerIdentityData = await sts.getCallerIdentity({}).promise();
    accountId = callerIdentityData.Account;
  } catch (e) {
    loglib.warning(`can not enrich account ${account.label} of type ${account.type} with id`, e);
  }
  try {
    const accountAliasesData = await iam.listAccountAliases({}).promise();
    if (accountAliasesData.AccountAliases.length === 1) {
      accountAlias = accountAliasesData.AccountAliases[0];
    }
  } catch (e) {
    loglib.warning(`can not enrich account ${account.label} of type ${account.type} with alias`, e);
  } 
  return Object.assign({}, account, {alias: accountAlias, id: accountId});
};

const fetchAwsAccounts = async (stdconsole, stdin, input) => {
  if (input['--env'] === true) {
    return [await enrichAwsAccount({
      type: 'env',
      label: 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN',
      config: {
        credentials: new AWS.EnvironmentCredentials('AWS')
      }
    })];
  } else if (input['--profile'] !== null || input['--all-profiles'] === true) {
    const profiles = await awscredslib.fetchProfiles();
    const accounts = [];
    const keys = Object.keys(profiles);
    for (const key of keys) {
      if (input['--profile'] !== null && key !== input['--profile']) {
        continue;
      }
      const profile = profiles[key];
      if ('aws_access_key_id' in profile && 'aws_secret_access_key' in profile) {
        const params = {
          accessKeyId: profile.aws_access_key_id,
          secretAccessKey: profile.aws_secret_access_key
        };
        if ('aws_session_token' in profile) {
          params.sessionToken = profile.aws_session_token;
        }
        const credentials = new AWS.Credentials(params);
        accounts.push(await enrichAwsAccount({
          type: 'access-key',
          label: `profile ${key}`,
          config: {
            credentials
          }
        }));
      } else if ('role_arn' in profile && 'source_profile' in profile && 'mfa_serial' in profile) {
        const sourceProfile = profiles[profile.source_profile];
        const masterParams = {
          accessKeyId: sourceProfile.aws_access_key_id,
          secretAccessKey: sourceProfile.aws_secret_access_key
        };
        if ('aws_session_token' in sourceProfile) {
          masterParams.sessionToken = sourceProfile.aws_session_token;
        }
        const masterCredentials = new AWS.Credentials(masterParams);
        try {
          const sessionTokenCredentials = await createSessionTokenCredentials(stdconsole, stdin, masterCredentials, profile.mfa_serial);
          const params = {
            RoleArn: profile.role_arn,
            RoleSessionName: `widdix-v${require('./package.json').version}`,
            DurationSeconds: 15 * 60 // TODO make timeout of 15 minutes configurable
          };
          if ('external_id' in profile) {
            params.ExternalId = profile.external_id;
          }
          const credentials = new AWS.TemporaryCredentials(params, sessionTokenCredentials);
          try {
            await credentials.getPromise();
            accounts.push(await enrichAwsAccount({
              type: 'role-mfa',
              label: `profile ${key}`,
              config: {
                credentials
              }
            }));
          } catch (e) {
            loglib.warning(`can not assume role for account profile ${key} of type role-mfa`, e);
          }
        } catch (e) {
          loglib.warning(`can not get session token for account profile ${key} of type role-mfa`, e);
        }
      } else if ('role_arn' in profile && 'source_profile' in profile) {
        const sourceProfile = profiles[profile.source_profile];
        const masterParams = {
          accessKeyId: sourceProfile.aws_access_key_id,
          secretAccessKey: sourceProfile.aws_secret_access_key
        };
        if ('aws_session_token' in sourceProfile) {
          masterParams.sessionToken = sourceProfile.aws_session_token;
        }
        const masterCredentials = new AWS.Credentials(masterParams);
        const params = {
          RoleArn: profile.role_arn,
          RoleSessionName: `widdix-v${require('./package.json').version}`,
          DurationSeconds: 15 * 60 // TODO make timeout of 15 minutes configurable
        };
        if ('external_id' in profile) {
          params.ExternalId = profile.external_id;
        }
        const credentials = new AWS.TemporaryCredentials(params, masterCredentials);
        try {
          await credentials.getPromise();
          accounts.push(await enrichAwsAccount({
            type: 'role',
            label: `profile ${key}`,
            config: {
              credentials
            }
          }));
        } catch (e) {
          loglib.warning(`can not assume role for account profile ${key} of type role`, e);
        }
      }
    }
    if (accounts.length === 0) {
      if (input['--profile'] !== null) {
        throw new Error(`profile ${input['--profile']} not found`);
      } else {
        throw new Error('no profiles found');
      }
    }
    return accounts;
  } else {
    return [await enrichAwsAccount({
      type: 'default',
      label: 'default AWS Nodejs. SDK chain',
      config: {}
    })];
  }
};

module.exports.clearCache = () => {
  downloadFileCache.clear();
  sessionTokenCredentialsCache.clear();
};

const displayAccount = (account) => {
  if (account.alias !== null) {
    return account.alias;
  }
  if (account.id !== null) {
    return account.id;
  }
  return `${account.label} of type ${account.type}`;
};

module.exports.run = async (argv, stdout, stderr, stdin) => {
  const cli = fs.readFileSync(path.join(__dirname, 'cli.txt'), {encoding: 'utf8'});
  const stdconsole = new console.Console(stdout, stderr);
  const input = docopt.docopt(cli, {
    version: require('./package.json').version,
    argv: argv
  });

  if (input['--debug'] === true) {
    loglib.setLevel('debug');
  } else {
    loglib.setLevel('info');
  }

  AWS.config.update({
    logger: {
      log: (message, data) => loglib.debug(message, data)
    }
  });

  if ('HTTPS_PROXY' in process.env) {
    loglib.debug(`using https proxy ${process.env.HTTPS_PROXY}`);
    AWS.config.update({
      httpOptions: {agent: proxy(process.env.HTTPS_PROXY)}
    });
  }

  AWS.config.update({
    region: 'us-east-1'
  });

  if (input.list === true) {
    const accounts = await fetchAwsAccounts(stdconsole, stdin, input);
    const rows = [];
    for (const account of accounts) {
      try {
        const stacks = await fetchAllStacks(account, input);
        const accountRows = stacks.map((stack) => {
          const row = [displayAccount(account), stack.region, stack.name, stack.templateId];
          if (stack.templateUpdateAvailable === true) {
            row.push(`${stack.templateVersion} (latest ${stack.templateLatestVersion})`);
          } else {
            row.push(stack.templateVersion);
          }
          row.push(stack.templateDrift);
          return row;
        });
        rows.push(...accountRows);
      } catch (err) {
        loglib.error(`can not access account ${account.label} of type ${account.type}`, err);
      }
    }
    tablelib.print(stdconsole, stdout.columns, ['Stack Account', 'Stack Region', 'Stack Name', 'Template ID', 'Template Version', 'Template Drift'], rows);
  } else if (input.graph === true) {
    const accounts = await fetchAwsAccounts(stdconsole, stdin, input);
    const intelligentLabelShortening = (label) => {
      return truncate(label, 12, 12, '...');
    };
    const groot = graphlib.create('root', `widdix-v${require('./package.json').version}`);
    for (const account of accounts) {
      try {
        const stacks = await fetchAllStacks(account, input);
        const gaccount = groot.subgraph(account.id, displayAccount(account));
        stacks.forEach(stack => {
          const gregion = gaccount.subgraph(stack.region, stack.region);
          let label = `${stack.templateId}\n${intelligentLabelShortening(stack.name)}\n`;
          if (stack.templateUpdateAvailable === true) {
            label += `${stack.templateVersion} (latest ${stack.templateLatestVersion})`;
          } else {
            label += stack.templateVersion;
          }
          gregion.create(`${stack.account.id}:${stack.region}:${stack.name}`, label, stack);
        });
        stacks.forEach(stack => {
          const gregion = gaccount.subgraph(stack.region, stack.region);
          const node = gregion.find(`${stack.account.id}:${stack.region}:${stack.name}`);
          stack.parentStacks.forEach(parentStack => {
            gregion.find(`${stack.account.id}:${stack.region}:${parentStack.stackName}`).connect(node);
          });
        });
      } catch (err) {
        loglib.error(`can not access account ${account.label} of type ${account.type}`, err);
      }
    }
    stdconsole.log(groot.toDOT());
  } else if (input.update === true) {
    const relevantStacks = async () => {
      if (input['--stack-name'] !== null) {
        const accounts = await fetchAwsAccounts(stdconsole, stdin, input);
        const stacks = [];
        for (const account of accounts) {
          const allStacks = await fetchAllStacks(account, input);
          Array.prototype.push.apply(stacks, allStacks.filter(stack => stack.name === input['--stack-name']));
        }
        if (stacks.length === 0) {
          throw new Error(`no stack found with name ${input['--stack-name']}`);
        } else if (stacks.length > 1) {
          throw new Error(`more then one stack found with name ${input['--stack-name']}. Set the --region parameter to restrict to a single region.`);
        }
        return stacks;
      } else {
        const accounts = await fetchAwsAccounts(stdconsole, stdin, input);
        const g = graphlib.create('root', `widdix-v${require('./package.json').version}`);
        for (const account of accounts) {
          const stacksRandomOrder = await fetchAllStacks(account, input);
          stacksRandomOrder.forEach(stack => {
            const id = `${stack.account.id}:${stack.region}:${stack.name}`;
            g.create(id, id, stack);
          });
          stacksRandomOrder.forEach(stack => {
            const id = `${stack.account.id}:${stack.region}:${stack.name}`;
            const node = g.find(id);
            stack.parentStacks.forEach(parentStack => {
              g.find(`${stack.account.id}:${stack.region}:${parentStack.stackName}`).connect(node);
            });
          });
        }
        return g.sort().map(node => node.data()).reverse(); // start with stacks that have no dependencies
      }
    };
    const stacks = (await relevantStacks());
    const updateableStacks = stacks.filter(stack => stack.templateUpdateAvailable === true);
    if (updateableStacks.length == 0) {
      throw new Error('no update available');
    }
    const updateableStacksWithTemplateDrift = updateableStacks.filter(stack => stack.templateDrift === true);
    for (const stack of updateableStacksWithTemplateDrift) {
      await yes(stdconsole, stdin, `Stack ${stack.name} in ${stack.region} uses a modified template. An update will override any modificytions. Continue?`, input['--yes']);
    }
    const stacksAndChangeSets = [];
    for (const stack of updateableStacks) { // TODO optimization, run regions in parallel
      const changeSet = await createChangeSet(stack);
      stacksAndChangeSets.push({
        stack,
        changeSet
      });
    }
    const rows = [];
    stacksAndChangeSets.forEach(({stack, changeSet}) => {
      rows.push([displayAccount(stack.account), stack.region, stack.name, stack.templateId, `${stack.templateVersion} (updating to ${stack.templateLatestVersion})`, 'AWS::CloudFormation::Stack', stack.name, 'Update']);
      changeSet.changes.map((change) => {
        const row = [displayAccount(stack.account), stack.region, stack.name, stack.templateId, `${stack.templateVersion} (updating to ${stack.templateLatestVersion})`, change.resource.type, change.resource.id];
        if (change.action === 'Modify') {
          if (change.actionModifyReplacement === 'True') {
            row.push('Replace');
          } else if (change.actionModifyReplacement === 'False') {
            row.push('Modify');
          } else if (change.actionModifyReplacement === 'Conditional') {
            row.push('Replace (Conditional)');
          } else {
            throw new Error(`unexpected actionModifyReplacement ${change.actionModifyReplacement}`);
          }
        } else {
          row.push(change.action);
        }
        rows.push(row);
      });
    });
    tablelib.print(stdconsole, stdout.columns, ['Stack Account', 'Stack Region', 'Stack Name', 'Template ID', 'Template Version', 'Resource Type', 'Resource Id', 'Resource Action'], rows);
    await yes(stdconsole, stdin, 'Apply changes?', input['--yes']);
    const eventTable = tablelib.create(['Time', 'Status', 'Type', 'Logical ID', 'Status Reason'], []);
    eventTable.printHeader(stdconsole, stdout.columns);
    for (const {stack, changeSet} of stacksAndChangeSets) {
      await executeChangeSet(stack, changeSet, (event) => {
        eventTable.printBodyRow(stdconsole, stdout.columns, [event.Timestamp, event.ResourceStatus, event.ResourceType, event.LogicalResourceId, event.ResourceStatusReason]);
      });
    }
    eventTable.printFooter(stdconsole, stdout.columns);
  }
};

