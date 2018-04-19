# widdix cli

A CLI tool to manage [Free Templates for AWS CloudFormation](https://github.com/widdix/aws-cf-templates).

## Install

TODO

## Available Commands

### List

To list all your stacks in an AWS account, run:

```
widdix list
```

A sample output looks like this:

```
-------------------------------------------------------------------------------------------------------------------------
| Stack Region | Stack Name              | Template ID                        | Template Version       | Template Drift |
-------------------------------------------------------------------------------------------------------------------------
| eu-west-1    | operations-alert        | operations/alert                   | 6.14.0                 | false          |
| eu-west-1    | jenkins-vpc-auth-proxy  | security/auth-proxy-ha-github-orga | 6.14.0                 | false          |
| eu-west-1    | jenkins-ha-agents       | jenkins/jenkins2-ha-agents         | 6.13.0 (latest 6.14.0) | false          |
| eu-west-1    | jenkins-vpc-ssh-bastion | vpc/vpc-ssh-bastion                | 6.14.0                 | false          |
| eu-west-1    | jenkins-vpc-2azs        | vpc/vpc-2azs                       | 6.14.0                 | false          |
-------------------------------------------------------------------------------------------------------------------------
```

To filter a AWS single region, run:

```
widdix list --region us-east-1
```

#### Columns

| Column           | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| Stack Region     | AWS region, like `us-east-1`.                                                          |
| Stack Name       | Name of AWS CloudFormation stack.                                                      |
| Template ID      | Template id, like `vpc/vpc-2azs`.                                                      |
| Template Version | Current version of the template. If an update is available it is added in parentheses. |
| Template Drift   | If you modified the template drift is detected.                                        |

### Graph

![Graph](graph.png)

To generate a graph in [DOT](https://graphviz.gitlab.io/_pages/doc/info/lang.html) format of your stacks in an AWS account, run:

```
widdix graph
```

To filter a single AWS region, run:

```
widdix graph --region us-east-1
```

Do visualize the graph in a png file, pipe stdout to `dot`:

```
widdix graph | dot -Tpng > graph.png
```

If you don't have `dot` installed, you can also use Docker:

```
widdix graph | docker run -i robhaswell/dot-docker -Tpng > graph.png
```

### Update

If a new version of the template is released, you can update your existing stacks. To update all stacks in interactive mode, run:

```
widdix update
```

The update behaves as follows:

1. If no updates are available, an error is thrown.
1. If template drift is detected we do not recommend to update! You have to confirm this potentially destructive action by typing `yes`.
1. Planed changes (using AWS CloudFormation change sets) that are necessary to migrate to the new version are displayed. 
1. You have to confirm the changes by typing `yes`.
1. Changes are applied and CloudWatch events are streamed to your screen.

You can filter AWS CloudFormation stacks based on region and/or AWS CloudFormation stack name like this:

```
widdix update --region us-east-1 --stack-name vpc
```

## Graphs

```
widdix graph | dot -Tpng > graph.png
```

## Config

### Proxy

The `HTTPS_PROXY` environment variable is used if set.

### AWS

The following environment variables are used if present. Earlier values win.

* `AWS_PROFILE`
* `AWS_ACCESS_KEY_ID`
* `AWS_SECRET_ACCESS_KEY`

The widdix cli is implemented using the AWS SDK for Node.js and behaves as the SDK specifies.
