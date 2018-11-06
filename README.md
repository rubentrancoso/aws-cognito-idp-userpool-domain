# aws-cognito-idp-userpool-domain


### Serverless.yml
```
service: myservice

plugins:
  - aws-cognito-idp-userpool-domain
custom:
  stage: ${opt:stage, self:provider.stage}  
```

### AWS::Cognito::UserPool resource
```
Resources:
  MyUserpool:
    Type: AWS::Cognito::UserPool
    Properties:
      AdminCreateUserConfig: 
        AllowAdminCreateUserOnly: true
        InviteMessageTemplate:
          EmailMessage: Your username is {username} and temporary password is {####}.  
          EmailSubject: Your temporary password
          SMSMessage: Your username is {username} and temporary password is {####}.
        UnusedAccountValidityDays: 7
      UsernameAttributes: 
        - email
      AutoVerifiedAttributes: 
        - email
      EmailConfiguration: 
        ReplyToEmailAddress: donotreply@domain.tld
      EmailVerificationMessage: Your verification code is {####}.
      EmailVerificationSubject: Your verification code
      MfaConfiguration: OFF
      Policies:
        PasswordPolicy:
          MinimumLength: 8
          RequireLowercase: true
          RequireNumbers: true
          RequireSymbols: false
          RequireUppercase: true
      UserPoolName: ${self:service}-${self:custom.stage}
  MyCognitoUserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      ClientName: ${self:service}-${self:custom.stage}-user-pool-client
      UserPoolId:
        Ref: MyUserpool
      GenerateSecret: true
```
 
