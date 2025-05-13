#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Finding Cognito Resources for Personal Backend API ===${NC}"

# Get the stack name from the user or use default
echo -e "\n${BLUE}Enter your CloudFormation stack name (default: personal-backend-api):${NC}"
read -r STACK_NAME
STACK_NAME=${STACK_NAME:-personal-backend-api}

# Get the AWS region from the user or use default
echo -e "\n${BLUE}Enter your AWS region (default: us-west-2):${NC}"
read -r AWS_REGION
AWS_REGION=${AWS_REGION:-us-west-2}

echo -e "\n${YELLOW}Searching for stack outputs...${NC}"
STACK_OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs" 2>&1)

if [[ $STACK_OUTPUTS == *"Stack with id $STACK_NAME does not exist"* ]]; then
  echo -e "${RED}Stack $STACK_NAME does not exist in region $AWS_REGION.${NC}"
  
  echo -e "\n${YELLOW}Available stacks in region $AWS_REGION:${NC}"
  aws cloudformation list-stacks --region "$AWS_REGION" --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName" --output table
else
  echo -e "${GREEN}Found stack $STACK_NAME in region $AWS_REGION.${NC}"
  
  # Extract Cognito User Pool ID
  USER_POOL_ID=$(echo "$STACK_OUTPUTS" | grep -o '"OutputKey": "CognitoUserPoolId".*"OutputValue": "[^"]*' | sed 's/.*"OutputValue": "//')
  
  # Extract Cognito User Pool Client ID
  CLIENT_ID=$(echo "$STACK_OUTPUTS" | grep -o '"OutputKey": "CognitoUserPoolClientId".*"OutputValue": "[^"]*' | sed 's/.*"OutputValue": "//')
  
  # Extract API Endpoint
  API_ENDPOINT=$(echo "$STACK_OUTPUTS" | grep -o '"OutputKey": "ApiEndpoint".*"OutputValue": "[^"]*' | sed 's/.*"OutputValue": "//')
  
  echo -e "\n${YELLOW}Stack outputs:${NC}"
  echo -e "${GREEN}Cognito User Pool ID:${NC} $USER_POOL_ID"
  echo -e "${GREEN}Cognito User Pool Client ID:${NC} $CLIENT_ID"
  echo -e "${GREEN}API Endpoint:${NC} $API_ENDPOINT"
  
  # Create a configuration file
  echo -e "\n${YELLOW}Creating configuration file...${NC}"
  cat > cognito-config.sh << EOF
# Cognito and API Gateway configuration
USER_POOL_ID="$USER_POOL_ID"
CLIENT_ID="$CLIENT_ID"
API_ENDPOINT="$API_ENDPOINT"
AWS_REGION="$AWS_REGION"
EOF
  
  echo -e "${GREEN}Configuration saved to cognito-config.sh${NC}"
  echo -e "${BLUE}You can source this file in your test script:${NC}"
  echo -e "source ./cognito-config.sh"
fi

echo -e "\n${YELLOW}Listing all Cognito User Pools in region $AWS_REGION:${NC}"
aws cognito-idp list-user-pools --max-results 10 --region "$AWS_REGION"

# If we found a User Pool ID, list its clients
if [ ! -z "$USER_POOL_ID" ]; then
  echo -e "\n${YELLOW}Listing clients for User Pool $USER_POOL_ID:${NC}"
  aws cognito-idp list-user-pool-clients --user-pool-id "$USER_POOL_ID" --region "$AWS_REGION"
fi

echo -e "\n${BLUE}=== Resource discovery complete ===${NC}"
echo -e "${YELLOW}To update your test script with these values:${NC}"
echo -e "1. Edit test-api.sh"
echo -e "2. Update the USER_POOL_ID, CLIENT_ID, and API_ENDPOINT variables"
echo -e "3. Make sure to remove any trailing slash from the API_ENDPOINT"