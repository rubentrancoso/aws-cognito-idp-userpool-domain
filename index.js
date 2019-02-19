'use strict';

const AWS = require('aws-sdk');
const util = require('util');
const chalk = require('chalk');

class ServerlessPlugin {

  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');
    try {
      this.servicename = this.serverless.service.getServiceName();
      this.stage = this.provider.getStage();
      this.region = this.provider.getRegion();

      AWS.config.update({
        region: this.region
      });
      
      this.cognitoIdp = new AWS.CognitoIdentityServiceProvider({ apiVersion: '2016-04-18' });

      this.stackname = this.servicename + '-' + this.stage;

      this.hooks = {
        // deploy
        'after:aws:package:finalize:mergeCustomProviderResources': this.add_outputs.bind(this),
        'after:deploy:deploy': this.process_deploy.bind(this),
        // remove
        'before:remove:remove': this.process_remove.bind(this)
      };
    } catch (error) {
      this.serverless.cli.log(error.stack);
    }
  }

  //===================================
  // Remove: before:remove:remove

  async process_remove() {
    this.plugin_log('process_remove started.');
    var that = this;
    // get userpool names from serverless.yml in a array
    var names = await this.get_sls_userpool_names();
    if(!names) {
      this.plugin_log('no userpools defined in serverless.yml to be to removed.');
      return;
    }
    // get userpool strutures from aws
    var userpools = await this.get_aws_cognito_userpools();
    if(!userpools) {
      this.plugin_log('no userpools on aws to be removed.');
      return;
    }  
    // process only the aws userpools that are defined on serverless.yml
    var userpools2process = [];  
    userpools.forEach(function (userpool) {
      if(names.includes(userpool.Name)) {
        userpools2process.push(userpool);
      }
    });

    if(userpools2process.length==0) {
      this.plugin_log('no userpools to remove.');
    }

    for(var userpoolindex in userpools2process) {
      var userpool = userpools2process[userpoolindex];
      await this.delete_userpool_domain(userpool.Id, userpool.Name);
    }
    this.plugin_log('process_remove finished.');
  }

  async get_sls_userpool_names() {
    if(this.serverless.service.resources===null || this.serverless.service.resources.Resources===null) {
      return null;
    }
    var names = [];
    var that = this;
    var keys = [];
    try {
      keys = Object.keys(this.serverless.service.resources.Resources);
    } catch (error) {
      this.plugin_log(error.stack);
    }
    keys.forEach(function (value) {
      var item = that.serverless.service.resources.Resources[value];
      if (item.Type == 'AWS::Cognito::UserPool') {
        names.push(item.Properties.UserPoolName);
      }
    });
    return names;
  }

  async get_aws_cognito_userpools() {
    var that = this;
    var userpools = [];
    var params = {
      MaxResults: 1, /* required */
      /* NextToken: 'STRING_VALUE' */
    };
    var hasNext = true;
    while(hasNext) {
      await this.cognitoIdp.listUserPools(params).promise().then(data => {
        if(data.UserPools.length != 0) {
          Array.prototype.push.apply(userpools,data.UserPools); 
          userpools.concat(data.UserPools);
          if(data.NextToken) {
            params.NextToken = data.NextToken;
          } else {
            hasNext = false;
          }
        } else {
          hasNext = false;
        }
      }).catch(error => {
        this.plugin_log(util.format('Error: %s, \'%s\'', error.code, error.message));
      });
    }
    if(userpools.length==0) {
      return null;
    } else {
      return userpools;
    }
  }  

  async delete_userpool_domain(userpoolid, domainname) {
    var that = this;
    this.plugin_log('Deleting user pool domain...');
    this.plugin_log(`userpoolid: [${userpoolid}], domainname: [${domainname}]`);
    try {
      var params = {
        Domain: domainname,
        UserPoolId: userpoolid
      };
      await this.cognitoIdp.deleteUserPoolDomain(params).promise().then(data => {
        that.plugin_log('domain deleted');
      }).catch(error => {
        that.plugin_log(util.format('Error: %s, \'%s\'', error.code, error.message));
      });
      this.plugin_log('done.');
    } catch (error) {
      this.plugin_log(error.stack);
    }
  }

  //===================================
  // Deploy: after:aws:package:finalize:mergeCustomProviderResources

  async add_outputs() {
    var resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
    for (let key in resources) {
      if (resources[key].Type === 'AWS::Cognito::UserPool') {
        await this.add_poolid_outputs('UserPoolId' + key, key);
      }
    }
  }

  async add_poolid_outputs(name, value) {
    var outputs = this.serverless.service.provider.compiledCloudFormationTemplate.Outputs;
    outputs[name] = { Value: { Ref: value } };
  }

  //===================================
  // Deploy: after:deploy:deploy

  async process_deploy() {
    this.plugin_log('process_deploy started.');
    var that = this;
    try {
      var userpoolids = await this.get_deployed_userpool_id()
      userpoolids = userpoolids
        .filter(upi => upi.name !== 'UserPoolId')
        .map(upi => {
          var cleanName = upi.name.substring(10)
          var resource = that.serverless.service.resources.Resources[cleanName]
          upi.domain = resource.Properties.UserPoolName
          return upi
        })
      userpoolids.forEach(async ({ id, domain }) => {
        await that.create_userpool_domain(id, domain)
      })
    } catch (error) {
      this.plugin_log(error.stack);
    }
    this.plugin_log('process_deploy finished.');
  }

  async create_userpool_domain(userpoolid, domainname) {
    this.plugin_log('Creating user pool domain...');
    this.plugin_log(`userpoolid: [${userpoolid}], domainname: [${domainname}]`);
    try {
      var params = {
        Domain: domainname,
        UserPoolId: userpoolid,
      };
      var that = this;
      await this.cognitoIdp.createUserPoolDomain(params).promise().then(data => {
        that.plugin_log('domain created');
      }).catch(error => {
        that.plugin_log(util.format('Error: %s, \'%s\'', error.code, error.message));
        that.plugin_log(error.stack);
      });
      this.plugin_log('done.');
    } catch (error) {
      this.plugin_log(error.stack);
    }
  }

  async get_deployed_userpool_id() {
    var user_pool_ids = [];
    try {
      var result = await this.fetch_CloudFormation_describeStacks();
      var result_array = result.Stacks[0].Outputs;
      result_array.forEach(function (item) {
        if (item.OutputKey.startsWith('UserPoolId')) {
          user_pool_ids.push({id:item.OutputValue,name:item.OutputKey});
        }
      });
      return user_pool_ids;
    } catch (error) {
      this.plugin_log(error.stack);
    }
  }  

  async fetch_CloudFormation_describeStacks() {
    try {
      var params = { StackName: this.stackname };
      return this.provider.request('CloudFormation', 'describeStacks', params);
    } catch (error) {
      this.plugin_log(error.stack);
    }
  }

  async plugin_log(msg) {
    this.serverless.cli.consoleLog(`${chalk.yellow('Plugin [aws-cognito-idp-userpool-domain]')}: ${msg}`);
  }

}

module.exports = ServerlessPlugin;

