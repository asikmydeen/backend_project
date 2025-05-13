#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Adding DynamoDB Permissions to Lambda Execution Role ===${NC}"

# Get the AWS region from the user or use default
echo -e "\n${BLUE}Enter your AWS region (default: us-west-2):${NC}"
read -r AWS_REGION
AWS_REGION=${AWS_REGION:-us-west-2}

# Create a policy document for DynamoDB access
echo -e "\n${YELLOW}Creating DynamoDB policy document...${NC}"
cat > dynamodb-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:${AWS_REGION}:*:table/personal-backend-api-*",
        "arn:aws:dynamodb:${AWS_REGION}:*:table/personal-backend-api-*/index/*"
      ]
    }
  ]
}
EOF

echo -e "${GREEN}Policy document created: dynamodb-policy.json${NC}"

# Create the policy
echo -e "\n${YELLOW}Creating IAM policy...${NC}"
POLICY_ARN=$(aws iam create-policy --policy-name PersonalBackendDynamoDBAccess --policy-document file://dynamodb-policy.json --query 'Policy.Arn' --output text 2>&1)

if [[ $POLICY_ARN == *"error"* ]]; then
  echo -e "${RED}Error creating policy: $POLICY_ARN${NC}"
  echo -e "${YELLOW}Checking if policy already exists...${NC}"
  ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
  POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/PersonalBackendDynamoDBAccess"
  
  POLICY_CHECK=$(aws iam get-policy --policy-arn $POLICY_ARN 2>&1)
  if [[ $POLICY_CHECK == *"error"* ]]; then
    echo -e "${RED}Policy does not exist and could not be created. Please check your IAM permissions.${NC}"
    exit 1
  else
    echo -e "${GREEN}Policy already exists: $POLICY_ARN${NC}"
  fi
else
  echo -e "${GREEN}Policy created: $POLICY_ARN${NC}"
fi

# Attach the policy to the Lambda execution role
echo -e "\n${YELLOW}Attaching policy to Lambda execution role...${NC}"
ATTACH_RESULT=$(aws iam attach-role-policy --role-name personal-backend-api-LambdaDefaultRole --policy-arn $POLICY_ARN 2>&1)

if [[ $ATTACH_RESULT == *"error"* ]]; then
  echo -e "${RED}Error attaching policy: $ATTACH_RESULT${NC}"
  exit 1
else
  echo -e "${GREEN}Policy successfully attached to role: personal-backend-api-LambdaDefaultRole${NC}"
fi

echo -e "\n${BLUE}=== DynamoDB Permissions Added Successfully ===${NC}"
echo -e "${YELLOW}Note: It may take a few minutes for the permissions to propagate.${NC}"
echo -e "${YELLOW}After waiting, run the test script again to verify the API is working.${NC}"