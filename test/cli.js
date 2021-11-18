import { strict as assert } from 'assert';
import nock from 'nock';
import stdiomock from 'stdio-mock';
import AWS from 'aws-sdk';


nock.disableNetConnect();
AWS.config.update({
  region: 'us-east-1',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  maxRetries: 0
});

import { clearCache, run } from '../cli.js';

const generateEc2DescribeRegionsResponse = (regions) => {
  let xml = '<DescribeRegionsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">';
  xml += '<requestId>b9b4b068-3a41-11e5-94eb-example</requestId>';
  xml += '<regionInfo>';
  regions.forEach(region => {
    xml += '<item>';
    xml += `<regionName>${region}</regionName>`;
    xml += `<regionEndpoint>ec2.${region}.amazonaws.com</regionEndpoint>`;
    xml += '</item>';
  });
  xml += '</regionInfo>';
  xml += '</DescribeRegionsResponse>';
  return xml;
};

const generateGitHubResponse = (version) => {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US"><entry><title>v${version}</title></entry></feed>`;
};

const generateCloudFormationDescribeStacksResponse = (stacks) => {
  let xml = '<DescribeStacksResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<DescribeStacksResult>';
  xml += '<Stacks>';
  stacks.forEach(stack => {
    xml += '<member>';
    xml += `<StackName>${stack.name}</StackName>`;
    xml += `<StackId>arn:aws:cloudformation:us-east-1:123456789:stack/${stack.name}/aaf549a0-a413-11df-adb3-5081b3858e83</StackId>`;
    xml += `<Description>${stack.description}</Description>`;
    xml += `<StackStatus>${stack.status}</StackStatus>`;
    xml += '<Outputs>';
    Object.keys(stack.outputs).forEach(key => {
      xml += '<member>';
      xml += `<OutputKey>${key}</OutputKey>`;
      xml += `<OutputValue>${stack.outputs[key]}</OutputValue>`;
      xml += '</member>';
    });
    xml += '</Outputs>';
    xml += '</member>';
  });
  xml += '</Stacks>';
  xml += '</DescribeStacksResult>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</DescribeStacksResponse>';
  return xml;
};

const generateCloudFormationGetTemplateSummaryResponse = (template) => {
  let xml = '<GetTemplateSummaryResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<GetTemplateSummaryResult>';
  xml += '<Description>A sample template description.</Description>';
  xml += '<Parameters>';
  Object.keys(template.parameters).forEach(key => {
    const parameter = template.parameters[key];
    xml += '<member>';
    xml += `<ParameterKey>${key}</ParameterKey>`;
    xml += `<ParameterType>${parameter.type}</ParameterType>`;
    xml += '<NoEcho>false</NoEcho>';
    if ('description' in parameter) {
      xml += `<Description>${parameter.description}</Description>`;
    }
    if ('default' in parameter) {
      xml += `<DefaultValue>${parameter.default}</DefaultValue>`;
    }
    xml += '</member>';
  });
  xml += '</Parameters>';
  xml += '<Version>2010-09-09</Version>';
  xml += '</GetTemplateSummaryResult>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</GetTemplateSummaryResponse>';
  return xml;
};

const generateCloudFormationDescribeChangeSetResponse = (changeSet) => {
  let xml = '<DescribeChangeSetResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<DescribeChangeSetResult>';
  xml += '<StackId>arn:aws:cloudformation:us-east-1:123456789012:stack/SampleStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</StackId>';
  xml += `<Status>${changeSet.status}</Status>`;
  xml += '<ChangeSetId>arn:aws:cloudformation:us-east-1:123456789012:changeSet/SampleChangeSet/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</ChangeSetId>';
  xml += '<StackName>SampleStack</StackName>';
  xml += '<ChangeSetName>SampleChangeSet-direct</ChangeSetName>';
  xml += '<NotificationARNs/>';
  xml += '<CreationTime>2016-03-17T23:35:25.813Z</CreationTime>';
  xml += '<Capabilities/>';
  /* TODO <Parameters>
    <member>
      <ParameterValue>testing</ParameterValue>
      <ParameterKey>Purpose</ParameterKey>
    </member>
    <member>
      <ParameterValue>MyKeyName</ParameterValue>
      <ParameterKey>KeyPairName</ParameterKey>
    </member>
    <member>
      <ParameterValue>t2.micro</ParameterValue>
      <ParameterKey>InstanceType</ParameterKey>
    </member>
  </Parameters>
  <Changes>
    <member>
      <ResourceChange>
        <Replacement>False</Replacement>
        <Scope>
          <member>Tags</member>
        </Scope>
        <Details>
          <member>
            <ChangeSource>DirectModification</ChangeSource>
            <Target>
              <RequiresRecreation>Never</RequiresRecreation>
              <Attribute>Tags</Attribute>
            </Target>
            <Evaluation>Static</Evaluation>
          </member>
        </Details>
        <LogicalResourceId>MyEC2Instance</LogicalResourceId>
        <Action>Modify</Action>
        <PhysicalResourceId>i-1abc23d4</PhysicalResourceId>
        <ResourceType>AWS::EC2::Instance</ResourceType>
      </ResourceChange>
      <Type>Resource</Type>
    </member>
  </Changes>*/
  xml += '</DescribeChangeSetResult>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</DescribeChangeSetResponse>';
  return xml;
};

const generateCloudFormationCreateChangeSetResponse = () => {
  let xml = '<CreateChangeSetResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<CreateChangeSetResult>';
  xml += '<Id>arn:aws:cloudformation:us-east-1:123456789012:changeSet/SampleChangeSet/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</Id>';
  xml += '</CreateChangeSetResult>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</CreateChangeSetResponse>';
  return xml;
};

const generateCloudFormationExecuteChangeSetResponse = () => {
  let xml = '<ExecuteChangeSetResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<ExecuteChangeSetResult/>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</ExecuteChangeSetResponse>';
  return xml;
};

const generateCloudFormationDescribeStackEventsResponse = () => {
  let xml = '<DescribeStackEventsResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<DescribeStackEventsResult>';
  xml += '<StackEvents>';
  xml += '<member>';
  xml += '<Timestamp>2016-03-15T20:54:31.809Z</Timestamp>';
  xml += '<ResourceStatus>UPDATE_COMPLETE</ResourceStatus>';
  xml += '<StackId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</StackId>';
  xml += '<EventId>1dedea10-eaf0-11e5-8451-500c5242948e</EventId>';
  xml += '<LogicalResourceId>MyStack</LogicalResourceId>';
  xml += '<StackName>MyStack</StackName>';
  xml += '<PhysicalResourceId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</PhysicalResourceId>';
  xml += '<ResourceType>AWS::CloudFormation::Stack</ResourceType>';
  xml += '</member>';
  xml += '<member>';
  xml += '<Timestamp>2016-03-15T20:54:30.174Z</Timestamp>';
  xml += '<ResourceStatus>CREATE_COMPLETE</ResourceStatus>';
  xml += '<StackId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</StackId>';
  xml += '<EventId>MyEC2Instance-CREATE_COMPLETE-2016-03-15T20:54:30.174Z</EventId>';
  xml += '<LogicalResourceId>MyEC2Instance</LogicalResourceId>';
  xml += '<StackName>MyStack</StackName>';
  xml += '<PhysicalResourceId>i-1abc23d4</PhysicalResourceId>';
  xml += '<ResourceProperties>{"ImageId":ami-8fcee4e5",...}</ResourceProperties>';
  xml += '<ResourceType>AWS::EC2::Instance</ResourceType>';
  xml += '</member>';
  xml += '<member>';
  xml += '<Timestamp>2016-03-15T20:53:17.660Z</Timestamp>';
  xml += '<ResourceStatus>CREATE_IN_PROGRESS</ResourceStatus>';
  xml += '<StackId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</StackId>';
  xml += '<EventId>MyEC2Instance-CREATE_IN_PROGRESS-2016-03-15T20:53:17.660Z</EventId>';
  xml += '<LogicalResourceId>MyEC2Instance</LogicalResourceId>';
  xml += '<ResourceStatusReason>Resource creation Initiated</ResourceStatusReason>';
  xml += '<StackName>MyStack</StackName>';
  xml += '<PhysicalResourceId>i-1abc23d4</PhysicalResourceId>';
  xml += '<ResourceProperties>{"ImageId":ami-8fcee4e5",...}</ResourceProperties>';
  xml += '<ResourceType>AWS::EC2::Instance</ResourceType>';
  xml += '</member>';
  xml += '<member>';
  xml += '<Timestamp>2016-03-15T20:53:16.516Z</Timestamp>';
  xml += '<ResourceStatus>CREATE_IN_PROGRESS</ResourceStatus>';
  xml += '<StackId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</StackId>';
  xml += '<EventId>MyEC2Instance-CREATE_IN_PROGRESS-2016-03-15T20:53:16.516Z</EventId>';
  xml += '<LogicalResourceId>MyEC2Instance</LogicalResourceId>';
  xml += '<StackName>MyStack</StackName>';
  xml += '<PhysicalResourceId/>';
  xml += '<ResourceProperties>{"ImageId":ami-8fcee4e5",...}</ResourceProperties>';
  xml += '<ResourceType>AWS::EC2::Instance</ResourceType>';
  xml += '</member>';
  xml += '<member>';
  xml += '<Timestamp>2016-03-15T20:53:11.231Z</Timestamp>';
  xml += '<ResourceStatus>UPDATE_IN_PROGRESS</ResourceStatus>';
  xml += '<StackId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</StackId>';
  xml += '<EventId>edbf2ac0-eaef-11e5-adeb-500c28903236</EventId>';
  xml += '<LogicalResourceId>MyStack</LogicalResourceId>';
  xml += '<ResourceStatusReason>User Initiated</ResourceStatusReason>';
  xml += '<StackName>MyStack</StackName>';
  xml += '<PhysicalResourceId>arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/12a3b456-0e10-4ce0-9052-5d484a8c4e5b</PhysicalResourceId>';
  xml += '<ResourceType>AWS::CloudFormation::Stack</ResourceType>';
  xml += '</member>';
  xml += '</StackEvents>';
  xml += '</DescribeStackEventsResult>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</DescribeStackEventsResponse>';
  return xml;
};

const generateCloudFormationGetTemplateResponse = () => {
  let xml = '<GetTemplateResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">';
  xml += '<GetTemplateResult>';
  xml += '<TemplateBody>';
  xml += 'test';
  xml += '</TemplateBody>';
  xml += '</GetTemplateResult>';
  xml += '<ResponseMetadata><RequestId>b9b4b068-3a41-11e5-94eb-example</RequestId></ResponseMetadata>';
  xml += '</GetTemplateResponse>';
  return xml;
};

const generateS3Reponse = () => {
  return 'test';
};

describe('cli', () => {
  afterEach(() => {
    nock.cleanAll();
    clearCache();
  });
  describe('list', () => {
    it('happy', (done) => {
      const github = nock('https://github.com')
        .get('/widdix/aws-cf-templates/releases.atom')
        .reply(200, generateGitHubResponse('6.13.0'), {'Content-Type': 'application/xml'});
      const ec2 = nock('https://ec2.us-east-1.amazonaws.com')
        .post('/')
        .reply(200, generateEc2DescribeRegionsResponse(['us-east-1']), {'Content-Type': 'application/xml'});
      const cloudformation = nock('https://cloudformation.us-east-1.amazonaws.com')
        .post('/', {
          Action: 'DescribeStacks',
          Version: '2010-05-15'
        })
        .reply(200, generateCloudFormationDescribeStacksResponse([{
          name: 'MyStack',
          description: 'test, a cloudonaut.io template',
          status: 'CREATE_COMPLETE',
          outputs: {
            TemplateID: 'test/test',
            TemplateVersion: '6.13.0'
          }
        }]), {'Content-Type': 'application/xml'})
        .post('/', {
          Action: 'GetTemplate',
          Version: '2010-05-15',
          StackName: 'MyStack'
        })
        .reply(200, generateCloudFormationGetTemplateResponse(), {'Content-Type': 'application/xml'});
      const s3 = nock('https://widdix-aws-cf-templates-releases-eu-west-1.s3.amazonaws.com')
        .get('/v6.13.0/test/test.yaml')
        .reply(200, generateS3Reponse());

      const {stdout, stdin, stderr} = stdiomock.stdio();
      stdout.columns = 300;
      run(['list'], stdout, stderr, stdin)
        .then(() => {
          assert.equal(ec2.isDone(), true);
          assert.equal(github.isDone(), true);
          assert.equal(cloudformation.isDone(), true);
          assert.equal(s3.isDone(), true);
          assert.equal(stderr.data().length, 0);
          const lines = stdout.data().join('').split('\n');
          assert.equal(lines.length, 6);
          assert.equal(lines[3].includes('us-east-1'), true);
          assert.equal(lines[3].includes('MyStack'), true);
          assert.equal(lines[3].includes('test'), true);
          assert.equal(lines[3].includes('6.13.0'), true);
          done();
        });
    });
  });
  describe('update', () => {
    describe('stack', () => {
      it('happy', (done) => {
        const github = nock('https://github.com')
          .get('/widdix/aws-cf-templates/releases.atom')
          .reply(200, generateGitHubResponse('6.13.0'), {'Content-Type': 'application/xml'});
        const ec2 = nock('https://ec2.us-east-1.amazonaws.com')
          .post('/')
          .reply(200, generateEc2DescribeRegionsResponse(['us-east-1']), {'Content-Type': 'application/xml'});
        const cloudformation = nock('https://cloudformation.us-east-1.amazonaws.com')
          .post('/', {
            Action: 'DescribeStacks',
            Version: '2010-05-15'
          })
          .reply(200, generateCloudFormationDescribeStacksResponse([{
            name: 'MyStack',
            description: 'test, a cloudonaut.io template',
            status: 'CREATE_COMPLETE',
            outputs: {
              TemplateID: 'test/test',
              TemplateVersion: '6.12.0'
            }
          }]), {'Content-Type': 'application/xml'})
          .post('/', {
            Action: 'GetTemplate',
            Version: '2010-05-15',
            StackName: 'MyStack'
          })
          .reply(200, generateCloudFormationGetTemplateResponse(), {'Content-Type': 'application/xml'})
          .post('/', {
            Action: 'GetTemplateSummary',
            Version: '2010-05-15',
            TemplateURL: /.*/
          })
          .reply(200, generateCloudFormationGetTemplateSummaryResponse({
            parameters: {
              NameA: {
                type: 'String',
                default: 'x'
              }
            }
          }), {'Content-Type': 'application/xml'})
          .post('/', {
            Action: 'CreateChangeSet',
            Version: '2010-05-15',
            Capabilities: {
              member: ['CAPABILITY_IAM']
            },
            ChangeSetName: /.*/,
            ChangeSetType: 'UPDATE',
            Description: /.*/,
            Parameters: {
              member: [{
                ParameterKey: 'NameA',
                ParameterValue: 'x'
              }]
            },
            StackName: 'MyStack',
            TemplateURL: 'https://s3-eu-west-1.amazonaws.com/widdix-aws-cf-templates-releases-eu-west-1/v6.13.0/test/test.yaml'
          })
          .reply(200, generateCloudFormationCreateChangeSetResponse(), {'Content-Type': 'application/xml'})
          .post('/', {
            Action: 'DescribeChangeSet',
            Version: '2010-05-15',
            ChangeSetName: /.*/,
            StackName: /.*/
          })
          .reply(200, generateCloudFormationDescribeChangeSetResponse({status: 'CREATE_COMPLETE'}), {'Content-Type': 'application/xml'})
          .post('/', {
            Action: 'ExecuteChangeSet',
            ChangeSetName: /.*/,
            StackName: 'MyStack',
            Version: '2010-05-15'
          })
          .reply(200, generateCloudFormationExecuteChangeSetResponse(), {'Content-Type': 'application/xml'})
          .post('/', {
            Action: 'DescribeStackEvents',
            Version: '2010-05-15',
            StackName: 'MyStack'
          })
          .reply(200, generateCloudFormationDescribeStackEventsResponse(), {'Content-Type': 'application/xml'});
        const s3 = nock('https://widdix-aws-cf-templates-releases-eu-west-1.s3.amazonaws.com')
          .get('/v6.12.0/test/test.yaml')
          .reply(200, generateS3Reponse());

        const {stdout, stdin, stderr} = stdiomock.stdio();
        stdout.columns = 300;
        stdout.on('data', (d) => {
          if (d.includes('Apply changes?')) {
            stdin.write('y');
          }
        });
        run(['update', '--stack-name', 'MyStack'], stdout, stderr, stdin)
          .then(() => {
            assert.equal(ec2.isDone(), true);
            assert.equal(github.isDone(), true);
            assert.equal(cloudformation.isDone(), true);
            assert.equal(s3.isDone(), true);
            assert.equal(stderr.data().length, 0);
            const lines = stdout.data().join('').split('\n');
            assert.equal(lines.length, 16);
            assert.equal(lines[3].includes('us-east-1'), true);
            assert.equal(lines[3].includes('MyStack'), true);
            assert.equal(lines[3].includes('test'), true);
            assert.equal(lines[3].includes('Update'), true);
            assert.equal(lines[5].includes('Apply changes?'), true);
            assert.equal(lines[9].includes('MyStack'), true);
            assert.equal(lines[9].includes('AWS::CloudFormation::Stack'), true);
            assert.equal(lines[9].includes('UPDATE_IN_PROGRESS'), true);
            assert.equal(lines[13].includes('MyStack'), true);
            assert.equal(lines[13].includes('AWS::CloudFormation::Stack'), true);
            assert.equal(lines[13].includes('UPDATE_COMPLETE'), true);
            done();
          });
      });
    });
  });
});
