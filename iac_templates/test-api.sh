#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Personal Backend API Testing Tool ===${NC}"
echo -e "${YELLOW}This script helps test your AWS SAM deployed backend API${NC}"

# Source configuration file if it exists
if [ -f "./cognito-config.sh" ]; then
  echo -e "${BLUE}Loading configuration from cognito-config.sh${NC}"
  source ./cognito-config.sh
else
  echo -e "${YELLOW}No configuration file found. Using default values.${NC}"
fi

# Check AWS CLI configuration
echo -e "\n${BLUE}Checking AWS CLI configuration...${NC}"
AWS_REGION=$(aws configure get region 2>/dev/null)
if [ -z "$AWS_REGION" ]; then
  echo -e "${RED}AWS CLI region not configured. Please run 'aws configure' first.${NC}"
  AWS_REGION="us-west-2"  # Default region
  echo -e "${YELLOW}Using default region: $AWS_REGION${NC}"
else
  echo -e "${GREEN}AWS CLI region: $AWS_REGION${NC}"
fi

# Ask for AWS region
echo -e "\n${YELLOW}NOTE: Your AWS CLI is configured for region $AWS_REGION${NC}"
echo -e "${BLUE}Enter the region where your stack is deployed (default: us-west-2):${NC}"
read -r AWS_REGION_INPUT
AWS_REGION=${AWS_REGION_INPUT:-"us-west-2"}
echo -e "${GREEN}Using region: $AWS_REGION${NC}"

# List available CloudFormation stacks in the specified region
echo -e "\n${BLUE}Available CloudFormation stacks in $AWS_REGION:${NC}"
STACKS=$(aws cloudformation list-stacks --region $AWS_REGION --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName" --output table 2>/dev/null)
echo "$STACKS"

# Ask for stack name
echo -e "\n${BLUE}Enter your CloudFormation stack name (default: personal-backend-api):${NC}"
read -r STACK_NAME_INPUT
STACK_NAME=${STACK_NAME_INPUT:-"personal-backend-api"}

# Try to get the API endpoint from CloudFormation outputs
echo -e "\n${BLUE}Attempting to find the API Gateway endpoint from CloudFormation...${NC}"
STACK_OUTPUTS=$(aws cloudformation describe-stacks --region $AWS_REGION --stack-name "$STACK_NAME" --query "Stacks[0].Outputs" 2>&1)

if [[ $STACK_OUTPUTS == *"does not exist"* ]]; then
  echo -e "${RED}Stack $STACK_NAME does not exist.${NC}"
  echo -e "${YELLOW}Using default API endpoint.${NC}"
  API_ENDPOINT=${API_ENDPOINT:-"https://c3wb0896md.execute-api.us-west-2.amazonaws.com/Prod"}
else
  # Extract Cognito User Pool ID
  USER_POOL_ID_FROM_CF=$(echo "$STACK_OUTPUTS" | grep -o '"OutputKey": "CognitoUserPoolId".*"OutputValue": "[^"]*' | sed 's/.*"OutputValue": "//')
  
  # Extract Cognito User Pool Client ID
  CLIENT_ID_FROM_CF=$(echo "$STACK_OUTPUTS" | grep -o '"OutputKey": "CognitoUserPoolClientId".*"OutputValue": "[^"]*' | sed 's/.*"OutputValue": "//')
  
  # Extract API Endpoint
  API_ENDPOINT_FROM_CF=$(echo "$STACK_OUTPUTS" | grep -o '"OutputKey": "ApiEndpoint".*"OutputValue": "[^"]*' | sed 's/.*"OutputValue": "//')
  
  if [ -n "$API_ENDPOINT_FROM_CF" ]; then
    echo -e "${GREEN}Found API endpoint from CloudFormation: $API_ENDPOINT_FROM_CF${NC}"
    API_ENDPOINT=${API_ENDPOINT:-$API_ENDPOINT_FROM_CF}
  else
    echo -e "${YELLOW}Could not find API endpoint from CloudFormation, using default${NC}"
    API_ENDPOINT=${API_ENDPOINT:-"https://c3wb0896md.execute-api.us-west-2.amazonaws.com/Prod"}
  fi
  
  if [ -n "$USER_POOL_ID_FROM_CF" ]; then
    echo -e "${GREEN}Found User Pool ID from CloudFormation: $USER_POOL_ID_FROM_CF${NC}"
    USER_POOL_ID=${USER_POOL_ID:-$USER_POOL_ID_FROM_CF}
  else
    echo -e "${YELLOW}Could not find User Pool ID from CloudFormation, using default${NC}"
    USER_POOL_ID=${USER_POOL_ID:-"us-west-2_C6WF8FsIK"}
  fi
  
  if [ -n "$CLIENT_ID_FROM_CF" ]; then
    echo -e "${GREEN}Found Client ID from CloudFormation: $CLIENT_ID_FROM_CF${NC}"
    CLIENT_ID=${CLIENT_ID:-$CLIENT_ID_FROM_CF}
  else
    echo -e "${YELLOW}Could not find Client ID from CloudFormation, using default${NC}"
    CLIENT_ID=${CLIENT_ID:-"7bdp9viins9m2uklrieqirgelj"}
  fi
fi

# List all Cognito User Pools
echo -e "\n${BLUE}Listing all Cognito User Pools in region $AWS_REGION:${NC}"
USER_POOLS=$(aws cognito-idp list-user-pools --region $AWS_REGION --max-results 10 2>&1)
echo "$USER_POOLS"

# Ask for User Pool ID
echo -e "\n${BLUE}Enter your Cognito User Pool ID (default: $USER_POOL_ID):${NC}"
read -r USER_POOL_ID_INPUT
USER_POOL_ID=${USER_POOL_ID_INPUT:-$USER_POOL_ID}

# Check if the User Pool exists
echo -e "\n${BLUE}Checking if User Pool $USER_POOL_ID exists...${NC}"
USER_POOL_CHECK=$(aws cognito-idp describe-user-pool --region $AWS_REGION --user-pool-id "$USER_POOL_ID" 2>&1)
if [[ $USER_POOL_CHECK == *"not exist"* ]]; then
  echo -e "${RED}User Pool $USER_POOL_ID does not exist.${NC}"
  echo -e "${RED}Please enter a valid User Pool ID from the list above.${NC}"
  exit 1
else
  echo -e "${GREEN}User Pool $USER_POOL_ID exists.${NC}"
  
  # List clients for this User Pool
  echo -e "\n${BLUE}Listing clients for User Pool $USER_POOL_ID:${NC}"
  CLIENT_LIST=$(aws cognito-idp list-user-pool-clients --region $AWS_REGION --user-pool-id "$USER_POOL_ID" 2>&1)
  echo "$CLIENT_LIST"
  
  # Try to extract the first client ID from the list
  FIRST_CLIENT_ID=$(echo "$CLIENT_LIST" | grep -o '"ClientId": "[^"]*' | head -1 | sed 's/"ClientId": "//')
  if [ -n "$FIRST_CLIENT_ID" ]; then
    echo -e "${GREEN}Found Client ID: $FIRST_CLIENT_ID${NC}"
    CLIENT_ID=${CLIENT_ID:-$FIRST_CLIENT_ID}
  fi
  
  # Ask for Client ID
  echo -e "\n${BLUE}Enter your Cognito User Pool Client ID (default: $CLIENT_ID):${NC}"
  read -r CLIENT_ID_INPUT
  CLIENT_ID=${CLIENT_ID_INPUT:-$CLIENT_ID}
fi

# Remove trailing slash from API_ENDPOINT if present
API_ENDPOINT=${API_ENDPOINT%/}
USERNAME="test@example.com"
PASSWORD="TestPassword123!"

# Debug mode - set to true to see verbose curl output
DEBUG=true

# Set curl options based on debug mode
if [ "$DEBUG" = true ]; then
  CURL_OPTS="-v"
else
  CURL_OPTS="-s"
fi

# Verify AWS resources before proceeding
echo -e "\n${BLUE}Verifying AWS resources...${NC}"

# Check if the Cognito User Pool exists
echo -e "\n${BLUE}Checking Cognito User Pool...${NC}"
USER_POOL_CHECK=$(aws cognito-idp describe-user-pool --region $AWS_REGION --user-pool-id "$USER_POOL_ID" 2>&1 || echo "User Pool not found")
if [[ $USER_POOL_CHECK == *"User Pool not found"* ]]; then
  echo -e "${RED}User Pool $USER_POOL_ID does not exist.${NC}"
  echo -e "${BLUE}Available User Pools:${NC}"
  aws cognito-idp list-user-pools --region $AWS_REGION --max-results 10
else
  echo -e "${GREEN}User Pool $USER_POOL_ID exists.${NC}"
fi

# Check if the Cognito User Pool Client exists
echo -e "\n${BLUE}Checking Cognito User Pool Client...${NC}"
CLIENT_CHECK=$(aws cognito-idp describe-user-pool-client --region $AWS_REGION --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" 2>&1 || echo "Client not found")
if [[ $CLIENT_CHECK == *"Client not found"* ]]; then
  echo -e "${RED}Client $CLIENT_ID does not exist in User Pool $USER_POOL_ID.${NC}"
  echo -e "${BLUE}Available Clients in User Pool:${NC}"
  aws cognito-idp list-user-pool-clients --region $AWS_REGION --user-pool-id "$USER_POOL_ID" 2>/dev/null || echo "Cannot list clients"
else
  echo -e "${GREEN}Client $CLIENT_ID exists in User Pool $USER_POOL_ID.${NC}"
fi

# Check API Gateway endpoint
echo -e "\n${BLUE}Checking API Gateway endpoint...${NC}"
API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$API_ENDPOINT")
if [ "$API_CHECK" == "403" ] || [ "$API_CHECK" == "401" ]; then
  echo -e "${GREEN}API Gateway endpoint is responding (status code: $API_CHECK).${NC}"
else
  echo -e "${RED}API Gateway endpoint returned status code: $API_CHECK${NC}"
  echo -e "${RED}Please verify the API endpoint URL.${NC}"
fi

echo -e "${BLUE}=== Testing Personal Backend API ===${NC}"

# Step 1: Register a user using API Gateway
echo -e "\n${BLUE}Step 1: Registering a user via API Gateway...${NC}"
REGISTER_RESPONSE=$(curl $CURL_OPTS -X POST \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\",\"email\":\"$USERNAME\"}" \
  "$API_ENDPOINT/api/v1/auth/register")

echo "Register Response: $REGISTER_RESPONSE"

# Step 1b: Alternative - Register directly with Cognito
echo -e "\n${BLUE}Step 1b: Registering a user directly with Cognito...${NC}"
COGNITO_REGISTER_RESPONSE=$(aws cognito-idp sign-up \
  --region $AWS_REGION \
  --client-id "$CLIENT_ID" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --user-attributes Name=email,Value="$USERNAME" \
  2>&1 || echo "Failed to register with Cognito")

echo "Cognito Register Response: $COGNITO_REGISTER_RESPONSE"

# Step 2: Confirm user (admin only)
echo -e "\n${BLUE}Step 2: Confirming user (admin only)...${NC}"
CONFIRM_RESPONSE=$(aws cognito-idp admin-confirm-sign-up \
  --region $AWS_REGION \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  2>&1 || echo "Failed to confirm user (may already be confirmed)")

echo "Confirm Response: $CONFIRM_RESPONSE"

# Step 3: Login to get tokens via API Gateway
echo -e "\n${BLUE}Step 3: Logging in via API Gateway...${NC}"
LOGIN_RESPONSE=$(curl $CURL_OPTS -X POST \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  "$API_ENDPOINT/api/v1/auth/login")

echo "Login Response: $LOGIN_RESPONSE"

# Step 3b: Alternative - Login directly with Cognito
echo -e "\n${BLUE}Step 3b: Logging in directly with Cognito...${NC}"
COGNITO_LOGIN_RESPONSE=$(aws cognito-idp initiate-auth \
  --region $AWS_REGION \
  --client-id "$CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
  2>&1 || echo "Failed to login with Cognito")

echo "Cognito Login Response: $COGNITO_LOGIN_RESPONSE"

# Extract token from API Gateway response
ID_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"idToken":"[^"]*' | sed 's/"idToken":"//')

# If API Gateway login failed, try to extract token from Cognito response
if [ -z "$ID_TOKEN" ]; then
  echo -e "${BLUE}Attempting to extract token from Cognito response...${NC}"
  ID_TOKEN=$(echo $COGNITO_LOGIN_RESPONSE | grep -o '"IdToken": "[^"]*' | sed 's/"IdToken": "//')
fi

if [ -z "$ID_TOKEN" ]; then
  echo -e "${RED}Failed to extract token from both API Gateway and Cognito responses.${NC}"
  echo -e "${RED}Please check the responses above for error details.${NC}"
  echo -e "${RED}You may need to delete the user and try again, or check your API configuration.${NC}"
  exit 1
fi

echo -e "${GREEN}Successfully obtained authentication token.${NC}"
echo -e "${BLUE}Token: ${NC}$ID_TOKEN"

# Step 4: Test creating a note
echo -e "\n${BLUE}Step 4: Creating a test note...${NC}"
CREATE_NOTE_RESPONSE=$(curl $CURL_OPTS -X POST \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Note","content":"This is a test note","tags":["test","api"]}' \
  "$API_ENDPOINT/api/v1/notes")

echo "Create Note Response: $CREATE_NOTE_RESPONSE"

# Extract note ID for later use
NOTE_ID=$(echo $CREATE_NOTE_RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//')
if [ ! -z "$NOTE_ID" ]; then
  echo -e "${GREEN}Successfully created note with ID: $NOTE_ID${NC}"
fi

# Step 5: List notes
echo -e "\n${BLUE}Step 5: Listing notes...${NC}"
LIST_NOTES_RESPONSE=$(curl $CURL_OPTS -X GET \
  -H "Authorization: Bearer $ID_TOKEN" \
  "$API_ENDPOINT/api/v1/notes")

echo "List Notes Response: $LIST_NOTES_RESPONSE"

# Step 6: Create an album
echo -e "\n${BLUE}Step 6: Creating a test album...${NC}"
CREATE_ALBUM_RESPONSE=$(curl $CURL_OPTS -X POST \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Album","description":"This is a test album"}' \
  "$API_ENDPOINT/api/v1/albums")

echo "Create Album Response: $CREATE_ALBUM_RESPONSE"

# Extract album ID for later use
ALBUM_ID=$(echo $CREATE_ALBUM_RESPONSE | grep -o '"id":"[^"]*' | sed 's/"id":"//')
if [ ! -z "$ALBUM_ID" ]; then
  echo -e "${GREEN}Successfully created album with ID: $ALBUM_ID${NC}"
fi

# Step 7: List albums
echo -e "\n${BLUE}Step 7: Listing albums...${NC}"
LIST_ALBUMS_RESPONSE=$(curl $CURL_OPTS -X GET \
  -H "Authorization: Bearer $ID_TOKEN" \
  "$API_ENDPOINT/api/v1/albums")

echo "List Albums Response: $LIST_ALBUMS_RESPONSE"

echo -e "\n${GREEN}API testing complete!${NC}"
echo -e "\n${BLUE}Troubleshooting Tips:${NC}"
echo -e "1. If you see 'Unauthorized' errors, check that your API Gateway endpoint is correct"
echo -e "2. Verify that the Cognito User Pool and Client ID are correct"
echo -e "3. Make sure the API Gateway is properly configured with the Cognito authorizer"
echo -e "4. Check CloudWatch logs for any Lambda function errors"