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

const fetchTemplateSummary = (url) => {
  const cloudformation = new AWS.CloudFormation({
    apiVersion: '2010-05-15'
  });
  return cloudformation.getTemplateSummary({
    TemplateURL: url
  }).promise();
};

const detectTemplateDrift = async (stackRegion, stackName, templateId, templateVersion) => {
  const cloudformation = new AWS.CloudFormation({
    apiVersion: '2010-05-15',
    region: stackRegion
  });
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
  const s3 = new AWS.S3({
    apiVersion: '2006-03-01'
  });
  const p = s3.getObject({
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

const fetchLatestTemplateVersion = async () => {
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

const fetchStacks = (region) => {
  const fetch = (previousStacks, nextToken) => {
    const cloudformation = new AWS.CloudFormation({
      apiVersion: '2010-05-15',
      region: region
    });
    return cloudformation.describeStacks({
      NextToken: nextToken
    }).promise()
      .then((data) => {
        const stacks = [...previousStacks, ...data.Stacks.map(stack => Object.assign({}, stack, {Region: stack.StackId.split(':')[3], AccountId: stack.StackId.split(':')[4]}))];
        if (data.NextToken !== null && data.NextToken !== undefined) {
          return fetch(stacks, data.NextToken);
        } else {
          return stacks;
        }
      });
  };
  return fetch([], null);
};

const fetchRegions = (region) => {
  if (region !== null) {
    return Promise.resolve([region]);
  } else {
    const ec2 = new AWS.EC2({apiVersion: '2016-11-15'});
    return ec2.describeRegions({}).promise()
      .then(data => data.Regions.map(region => region.RegionName));
  }
};

const enrichStack = async (stdconsole, templateId, templateVersion, stack) => {
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
  const latestVersion = await fetchLatestTemplateVersion().catch(e => {
    loglib.warning(`can not get latest template version in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
    return undefined;
  });
  const templateDrift = await detectTemplateDrift(stack.Region, stack.StackName, templateId, templateVersion).catch(e => {
    loglib.warning(`can not get detect template drift in ${stack.Region} for stack ${stack.StackName} (${templateId} v${templateVersion})`, e);
    return undefined;
  });
  return {
    accountId: stack.AccountId,
    region: stack.Region,
    name: stack.StackName,
    parameters: stack.Parameters.reduce((acc, parameter) => {
      acc[parameter.ParameterKey] = parameter.ParameterValue;
      return acc;
    }, {}),
    templateId,
    templateVersion,
    templateDrift: templateDrift,
    templateLatestVersion: latestVersion,
    templateUpdateAvailable: isUpdateAvailable(latestVersion, templateVersion)
  };
};

const fetchAllStacks = (stdconsole, region) => {
  return fetchRegions(region)
    .then(regions => Promise.all(regions.map(region => fetchStacks(region))))
    .then(stackLists => {
      return Promise.all(
        stackLists
          .reduce((acc, stacks) => [...acc, ...stacks], [])
          .filter((stack) => {
            return stack.Outputs.some((output) => (output.OutputKey === 'TemplateID' && output.OutputValue.includes('/')));
          })
          .map((stack) => {
            const templateId = extractTemplateIDFromStack(stack);
            const templateVersion = extractTemplateVersionFromStack(templateId, stack);
            return enrichStack(stdconsole, templateId, templateVersion, stack);
          })
      );
    });
};

const yes = (alwaysYes, question, stdconsole, stdin) => {
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
  const cloudformation = new AWS.CloudFormation({
    apiVersion: '2010-05-15',
    region: stack.region
  });
  const changeSetName = `widdix-${crypto.randomBytes(16).toString('hex')}`;
  const templateURL = `https://s3-eu-west-1.amazonaws.com/widdix-aws-cf-templates-releases-eu-west-1/v${stack.templateLatestVersion}/${stack.templateId}.yaml`;
  const template = await fetchTemplateSummary(templateURL);
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
    Description: `widdix ${require('./package.json').version}`,
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
  const cloudformation = new AWS.CloudFormation({
    apiVersion: '2010-05-15',
    region: stack.region
  });
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
  const cloudformation = new AWS.CloudFormation({
    apiVersion: '2010-05-15',
    region: stack.region
  });
  await cloudformation.executeChangeSet({
    ChangeSetName: changeSet.name,
    StackName: stack.name
  }).promise();
  await tailStackEvents(stack, 'UPDATE', eventCallback);
};

module.exports.clearCache = () => {
  downloadFileCache.clear();
};

module.exports.run = async (argv, stdout, stderr, stdin) => {
  const cli = fs.readFileSync(path.join(__dirname, 'cli.txt'), {encoding: 'utf8'});
  const stdconsole = new console.Console(stdout, stderr);
  const input = docopt.docopt(cli, {
    version: require('./package.json').version,
    argv: argv
  });

  if (input['--debug'] === true) {
    AWS.config.update({
      logger: {
        log: stdconsole.log
      }
    });
  }

  if ('HTTPS_PROXY' in process.env) {
    if (input['--debug'] === true) {
      stdconsole.info(`using https proxy ${process.env.HTTPS_PROXY}`);
    }
    AWS.config.update({
      httpOptions: {agent: proxy(process.env.HTTPS_PROXY)}
    });
  }

  AWS.config.update({
    region: 'us-east-1'
  });

  if (input.list === true) {
    const stacks = await fetchAllStacks(stdconsole, input['--region']);
    const rows = stacks.map((stack) => {
      const row = [stack.accountId, stack.region, stack.name, stack.templateId];
      if (stack.templateUpdateAvailable === true) {
        row.push(`${stack.templateVersion} (latest ${stack.templateLatestVersion})`);
      } else {
        row.push(stack.templateVersion);
      }
      row.push(stack.templateDrift);
      return row;
    });
    tablelib.print(stdconsole, stdout.columns, ['Stack Account ID', 'Stack Region', 'Stack Name', 'Template ID', 'Template Version', 'Template Drift'], rows);
  } else if (input.graph === true) {
    const intelligentLabelShortening = (label) => {
      return truncate(label, 12, 12, '...');
    };
    const stacks = await fetchAllStacks(stdconsole, input['--region']);
    const groot = graphlib.create('root', `widdix ${require('./package.json').version}`);
    stacks.forEach(stack => {
      const g = groot.subgraph(stack.region, stack.region);
      let label = `${stack.templateId}\n${intelligentLabelShortening(stack.name)}\n`;
      if (stack.templateUpdateAvailable === true) {
        label += `${stack.templateVersion} (latest ${stack.templateLatestVersion})`;
      } else {
        label += stack.templateVersion;
      }
      g.create(`${stack.region}:${stack.name}`, label, stack);
    });
    stacks.forEach(stack => {
      const g = groot.subgraph(stack.region, stack.region);
      const node = g.find(`${stack.region}:${stack.name}`);
      Object.keys(stack.parameters)
        .filter(key => key.startsWith('Parent'))
        .forEach(key => {
          const parentStackName = stack.parameters[key];
          if (parentStackName !== '') {
            g.find(`${stack.region}:${parentStackName}`).connect(node);
          }
        });
    });
    stdconsole.log(groot.toDOT());
  } else if (input.update === true) {
    const relevantStacks = async () => {
      if (input['--stack-name'] !== null) {
        const allStacks = await fetchAllStacks(stdconsole, input['--region']);
        const stacks = allStacks.filter(stack => stack.name === input['--stack-name']);
        if (stacks.length === 0) {
          throw new Error(`no stack found with name ${input['--stack-name']}`);
        } else if (stacks.length > 1) {
          throw new Error(`more then one stack found with name ${input['--stack-name']}. Set the --region parameter to restrict to a single region.`);
        }
        return stacks;
      } else {
        const stacksRandomOrder = await fetchAllStacks(stdconsole, input['--region']);
        const g = graphlib.create('root', `widdix ${require('./package.json').version}`);
        stacksRandomOrder.forEach(stack => {
          const id = `${stack.region}:${stack.name}`;
          g.create(id, id, stack);
        });
        stacksRandomOrder.forEach(stack => {
          const node = g.find(`${stack.region}:${stack.name}`);
          Object.keys(stack.parameters)
            .filter(key => key.startsWith('Parent'))
            .forEach(key => {
              const parentStackName = stack.parameters[key];
              if (parentStackName !== '') {
                g.find(`${stack.region}:${parentStackName}`).connect(node);
              }
            });
        });
        return g.sort().map(node => node.data()).reverse();  // start with stacks that have no dependencies
      }
    };
    const stacks = (await relevantStacks());
    const updateableStacks = stacks.filter(stack => stack.templateUpdateAvailable === true);
    if (updateableStacks.length == 0) {
      throw new Error('no update available');
    }
    const updateableStacksWithTemplateDrift = updateableStacks.filter(stack => stack.templateDrift === true);
    for (const stack of updateableStacksWithTemplateDrift) {
      await yes(input['--yes'], `Stack ${stack.name} in ${stack.region} uses a modified template. An update will override any modificytions. Continue?`, stdconsole, stdin);
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
      rows.push([stack.accountId, stack.region, stack.name, stack.templateId, `${stack.templateVersion} (updating to ${stack.templateLatestVersion})`, 'AWS::CloudFormation::Stack', stack.name, 'Update']);
      changeSet.changes.map((change) => {
        const row = [stack.accountId, stack.region, stack.name, stack.templateId, change.resource.type, change.resource.id];
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
    tablelib.print(stdconsole, stdout.columns, ['Stack Account ID', 'Stack Region', 'Stack Name', 'Template ID', 'Template Version', 'Resource Type', 'Resource Id', 'Resource Action'], rows);
    await yes(input['--yes'], 'Apply changes?', stdconsole, stdin);
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

