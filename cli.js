import crypto from 'crypto';
import fs from 'fs';
import console from 'console';
import requestretry from 'requestretry';
import docopt from 'docopt';
import semver from 'semver';
import proxy from 'proxy-agent';
import truncate from 'truncate-middle';
import md5 from 'md5';
import pLimit from 'p-limit';
import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import {
  CloudFormationClient,
  GetTemplateSummaryCommand,
  GetTemplateCommand,
  DescribeChangeSetCommand,
  CreateChangeSetCommand,
  ExecuteChangeSetCommand,
  paginateDescribeStacks,
  paginateDescribeStackEvents,
  waitUntilChangeSetCreateComplete
} from '@aws-sdk/client-cloudformation';
import { IAMClient, ListAccountAliasesCommand } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromIni, fromEnv } from '@aws-sdk/credential-providers';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler'; 

import { create as gcreate } from './lib/graph.js';
import { create as tcreate, print as tprint } from './lib/table.js';
import { warning, error, setLevel } from './lib/log.js';
import { fetchProfiles } from './lib/aws-credentials.js';

const { version } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), {encoding: 'utf8'}));

function generateAwsConfig(account, configOverrides) {
  const proxyConfig = {};
  if ('HTTPS_PROXY' in process.env) {
    proxyConfig.requestHandler = new NodeHttpHandler({
      httpAgent: proxy(process.env.HTTPS_PROXY),
      httpsAgent: proxy(process.env.HTTPS_PROXY)
    });
  }
  return Object.assign({region: 'us-east-1'}, account.config, proxyConfig, configOverrides);
}

function generateAwsCloudFormationConfig(account, configOverrides) {
  const config = {
    apiVersion: '2010-05-15',
    maxAttempts: process.env.NODE_ENV === 'production' ? 12 : 1
  };
  return generateAwsConfig(account, Object.assign({}, config, configOverrides));
}

async function fetchTemplateSummary (account, url) {
  const cloudformation = new CloudFormationClient(generateAwsCloudFormationConfig(account, {}));
  return cloudformation.send(new GetTemplateSummaryCommand({
    TemplateURL: url
  }));
}

async function detectTemplateDrift(account, stackRegion, stackName, templateId, templateVersion) {
  const cloudformation = new CloudFormationClient(generateAwsCloudFormationConfig(account, {region: stackRegion}));
  if (templateVersion === undefined) {
    return undefined;
  } else {
    const rawTemplate = await downloadS3File(`v${templateVersion}/${templateId}.yaml`);
    const liveTemplate = await cloudformation.send(new GetTemplateCommand({
      StackName: stackName
    }));
    // CloudFormation replaces non-ascii chars with ? 
    const rawMd5 = md5(rawTemplate.replace(/[^\x00-\x7F]/g, '?').trim()); // eslint-disable-line no-control-regex 
    const liveMd5 = md5(liveTemplate.TemplateBody.trim());
    return rawMd5 !== liveMd5;
  }
}

const downloadFileCache = new Map();

async function downloadS3File(key) {
  return downloadFile(`https://widdix-aws-cf-templates-releases-eu-west-1.s3.eu-west-1.amazonaws.com/${key}`);
}

async function downloadFile(url) { // includes caching
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
}

async function fetchLatestTemplateVersion(input) {
  if (input['--latest-version'] !== null) {
    return input['--latest-version'];
  }
  const body = await downloadFile('https://github.com/widdix/aws-cf-templates/releases.atom');
  return body.match(/<title>(v[0-9.]*)<\/title>/i)[1].replace('v', '');
}

function extractTemplateIDFromStack(stack) {
  const templateId = stack.Outputs.find((output) => output.OutputKey === 'TemplateID').OutputValue;
  if (templateId === undefined) {
    warning(`can not extract template id in ${stack.Region} for stack ${stack.StackName}`, stack);
  }
  return templateId;
}

function extractTemplateVersionFromStack(templateId, stack) {
  const output = stack.Outputs.find((output) => output.OutputKey === 'TemplateVersion');
  if (output === undefined || output.OutputValue === '__VERSION__') {
    warning(`can not extract template version in ${stack.Region} for stack ${stack.StackName} (${templateId})`, stack);
    return undefined;
  }
  return output.OutputValue;
}

function extractParentStacksFromParameters(parameters) {
  return Object.keys(parameters)
    .filter(key => key.startsWith('Parent'))
    .filter(key => parameters[key] !== '')
    .map(key => ({
      parameterName: key,
      stackName: parameters[key]
    }));
}

function initArrayIfUndefined(obj, name) {
  if (!Array.isArray(obj[name])) {
    obj[name] = [];
  }
  return obj;
}

async function fetchStacks(account, region) {
  const cloudformation = new CloudFormationClient(generateAwsCloudFormationConfig(account, {region: region}));
  const stacks = [];
  const paginator = paginateDescribeStacks({
    client: cloudformation
  }, {});
  for await (const page of paginator) {
    page.Stacks
      .map(stack => Object.assign({}, stack, {Region: region}))
      .map(stack => initArrayIfUndefined(stack, 'Parameters'))
      .map(stack => initArrayIfUndefined(stack, 'Outputs'))
      .forEach(stack => stacks.push(stack));
  }
  return stacks;
}

async function fetchRegions(account, region) {
  if (region !== null) {
    return Promise.resolve([region]);
  } else {
    const ec2 = new EC2Client(generateAwsConfig(account, {apiVersion: '2016-11-15'}));
    const data = await ec2.send(new DescribeRegionsCommand({}));
    return data.Regions.map(region => region.RegionName);
  }
}

async function enrichStack(account, stack, input) {
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
      warning(`can not compare latest template version (v${latestVersion}) in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
      return undefined;
    }    
  };
  const latestVersion = await fetchLatestTemplateVersion(input).catch(e => {
    warning(`can not get latest template version in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
    return undefined;
  });
  const templateDrift = await detectTemplateDrift(account, stack.Region, stack.StackName, templateId, templateVersion).catch(e => {
    warning(`can not get detect template drift in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
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
}

async function fetchAllStacks(account, input) {
  const limit = pLimit(4);
  return fetchRegions(account, input['--region'])
    .then(regions => Promise.all(regions.map(region => fetchStacks(account, region))))
    .then(stackLists => {
      return Promise.all(
        stackLists
          .flat()
          .filter(stack => !stack.StackName.startsWith('StackSet-'))
          .filter((stack) => {
            return stack.Outputs.some((output) => (output.OutputKey === 'TemplateID' && output.OutputValue.includes('/')));
          })
          .map((stack) => limit(() => enrichStack(account, stack, input)))
      );
    });
}

async function yes(stdconsole, stdin, question, alwaysYes) {
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
}

async function createChangeSet(stack) {
  const cloudformation = new CloudFormationClient(generateAwsCloudFormationConfig(stack.account, {region: stack.region}));
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
  await cloudformation.send(new CreateChangeSetCommand({
    ChangeSetName: changeSetName,
    StackName: stack.name,
    ChangeSetType: 'UPDATE',
    Description: `widdix-v${version}`,
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
  }));
  await waitUntilChangeSetCreateComplete({
    client: cloudformation
  }, {
    StackName: stack.name,
    ChangeSetName: changeSetName
  });
  const data = await cloudformation.send(new DescribeChangeSetCommand({
    StackName: stack.name,
    ChangeSetName: changeSetName
  }));
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
}

async function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tailStackEvents(stack, changeSetType, eventCallback) {
  const cloudformation = new CloudFormationClient(generateAwsCloudFormationConfig(stack.account, {region: stack.region}));
  const publishedEventIds = new Set();
  const publishEvent = (event) => {
    publishedEventIds.add(event.EventId);
    eventCallback(event);
  };
  const fetchAll = async () => {
    const allEvents = [];
    const paginator = paginateDescribeStackEvents({
      client: cloudformation
    }, {
      StackName: stack.name
    });
    for await (const page of paginator) {
      page.StackEvents.forEach(event => allEvents.push(event));
    }
    return allEvents;
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
}

async function executeChangeSet(stack, changeSet, eventCallback) {
  const cloudformation = new CloudFormationClient(generateAwsCloudFormationConfig(stack.account, {region: stack.region}));
  await cloudformation.send(new ExecuteChangeSetCommand({
    ChangeSetName: changeSet.name,
    StackName: stack.name
  }));
  await tailStackEvents(stack, 'UPDATE', eventCallback);
}

async function token(stdconsole, stdin, question) {
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
}

async function enrichAwsAccount(account) {
  const iam = new IAMClient(generateAwsConfig(account, {apiVersion: '2010-05-08'}));
  const sts = new STSClient(generateAwsConfig(account, {apiVersion: '2011-06-15'}));
  let accountId = null;
  let accountAlias = null;
  try {
    const callerIdentityData = await sts.send(new GetCallerIdentityCommand({}));
    accountId = callerIdentityData.Account;
  } catch (e) {
    warning(`can not enrich account ${account.label} of type ${account.type} with id`, e);
  }
  try {
    const accountAliasesData = await iam.send(new ListAccountAliasesCommand({}));
    if (accountAliasesData.AccountAliases.length === 1) {
      accountAlias = accountAliasesData.AccountAliases[0];
    }
  } catch (e) {
    warning(`can not enrich account ${account.label} of type ${account.type} with alias`, e);
  } 
  return Object.assign({}, account, {alias: accountAlias, id: accountId});
}

async function fetchAwsAccounts(stdconsole, stdin, input) {
  if (input['--env'] === true) {
    return [await enrichAwsAccount({
      type: 'env',
      label: 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN',
      config: {
        credentials: fromEnv()
      }
    })];
  } else if (input['--profile'] !== null || input['--all-profiles'] === true) {
    const profiles = await fetchProfiles();
    const accounts = [];
    const keys = Object.keys(profiles);
    for (const key of keys) {
      if (input['--profile'] !== null && key !== input['--profile']) {
        continue;
      }      
      const credentials = fromIni({
        profile: key,
        mfaCodeProvider: async (mfaSerial) => token(stdconsole, stdin, `Please enter the MFA token for ${mfaSerial}`)
      });
      accounts.push(await enrichAwsAccount({
        type: 'profile',
        label: `profile ${key}`,
        config: {
          credentials
        }
      }));
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
}

export function clearCache() {
  downloadFileCache.clear();
}

function displayAccount(account) {
  if (account.alias !== null) {
    return account.alias;
  }
  if (account.id !== null) {
    return account.id;
  }
  return `${account.label} of type ${account.type}`;
}

export async function run(argv, stdout, stderr, stdin) {
  const cli = fs.readFileSync(new URL('./cli.txt', import.meta.url), {encoding: 'utf8'});
  const stdconsole = new console.Console(stdout, stderr);
  const input = docopt.docopt(cli, {
    version,
    argv: argv
  });

  if (input['--debug'] === true) {
    setLevel('debug');
  } else {
    setLevel('info');
  }

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
        error(`can not access account ${account.label} of type ${account.type}`, err);
      }
    }
    tprint(stdconsole, stdout.columns, ['Stack Account', 'Stack Region', 'Stack Name', 'Template ID', 'Template Version', 'Template Drift'], rows);
  } else if (input.graph === true) {
    const accounts = await fetchAwsAccounts(stdconsole, stdin, input);
    const intelligentLabelShortening = (label) => {
      return truncate(label, 12, 12, '...');
    };
    const groot = gcreate('root', `widdix-v${version}`);
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
        error(`can not access account ${account.label} of type ${account.type}`, err);
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
        const g = gcreate('root', `widdix-v${version}`);
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
    tprint(stdconsole, stdout.columns, ['Stack Account', 'Stack Region', 'Stack Name', 'Template ID', 'Template Version', 'Resource Type', 'Resource Id', 'Resource Action'], rows);
    await yes(stdconsole, stdin, 'Apply changes?', input['--yes']);
    const eventTable = tcreate(['Time', 'Status', 'Type', 'Logical ID', 'Status Reason'], []);
    eventTable.printHeader(stdconsole, stdout.columns);
    for (const {stack, changeSet} of stacksAndChangeSets) {
      await executeChangeSet(stack, changeSet, (event) => {
        eventTable.printBodyRow(stdconsole, stdout.columns, [event.Timestamp, event.ResourceStatus, event.ResourceType, event.LogicalResourceId, event.ResourceStatusReason]);
      });
    }
    eventTable.printFooter(stdconsole, stdout.columns);
  }
}
