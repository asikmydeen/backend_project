# Personal Backend API

This project deploys a serverless backend API using AWS SAM (Serverless Application Model). It includes authentication, notes, albums, bookmarks, and other personal data management features.

## Deployment Information

- **Cognito User Pool ID**: us-west-2_C6WF8FsIK
- **Cognito User Pool Client ID**: 7bdp9viins9m2uklrieqirgelj
- **API Endpoint**: [Your API Gateway endpoint URL]

## Testing the API

### Option 1: Using the Test Script

1. The `test-api.sh` script has been updated with your API endpoint, but you may need to verify it:
   ```bash
   # Remove trailing slash to prevent double slash in URLs
   API_ENDPOINT="https://c3wb0896md.execute-api.us-west-2.amazonaws.com/Prod"
   
   # These IDs need to be verified
   CLIENT_ID="7bdp9viins9m2uklrieqirgelj"
   USER_POOL_ID="us-west-2_C6WF8FsIK"
   ```

2. Make the script executable (if not already):
   ```bash
   chmod +x test-api.sh
   ```

3. Run the script:
   ```bash
   ./test-api.sh
   ```

4. **Important**: The script now includes verification steps to check if your Cognito User Pool and Client ID exist. If they don't exist, you'll need to update them with the correct values from the AWS Console or CloudFormation outputs.

   To find the correct values:
   
   ```bash
   # List all Cognito User Pools
   aws cognito-idp list-user-pools --max-results 10
   
   # Once you have the correct User Pool ID, list its clients
   aws cognito-idp list-user-pool-clients --user-pool-id YOUR_USER_POOL_ID
   
   # Get the CloudFormation stack outputs
   aws cloudformation describe-stacks --stack-name personal-backend-api --query "Stacks[0].Outputs"
   ```

5. **Interactive Test Script**: The updated test script is now fully interactive:

   ```bash
   # Make the script executable
   chmod +x test-api.sh
   
   # Run the script
   ./test-api.sh
   ```
   
   The script will:
   - Check your AWS CLI configuration
   - List available CloudFormation stacks
   - Ask for your stack name, User Pool ID, and Client ID
   - Automatically discover resources from CloudFormation outputs
   - Verify that resources exist before proceeding
   - Guide you through the testing process with clear prompts
   - Provide detailed troubleshooting information

6. **Helper Script**: We've also created a helper script to find the correct Cognito resources:

   ```bash
   # Make the script executable
   chmod +x find-cognito-resources.sh
   
   # Run the script
   ./find-cognito-resources.sh
   ```
   
   This script will:
   - Ask for your stack name and AWS region
   - Find the Cognito User Pool ID, Client ID, and API Endpoint from the stack outputs
   - Create a configuration file that you can source in your test script
   - List all available Cognito User Pools and clients

The script will:
- Try to register a user both via API Gateway and directly with Cognito
- Confirm the user in Cognito
- Attempt to log in both via API Gateway and directly with Cognito
- Create a test note
- List all notes
- Create a test album
- List all albums

#### Debugging the Test Script

If you encounter issues:

1. Enable debug mode in the script (already enabled by default):
   ```bash
   DEBUG=true
   ```

2. Check the verbose output for any error messages or HTTP status codes

3. Common issues and solutions:
   - **"Unauthorized" errors**: Check API Gateway configuration and Cognito authorizer
   - **Cognito errors**: Verify user pool ID and client ID
   - **API Gateway errors**: Ensure endpoints are correctly configured
   - **Lambda errors**: Check CloudWatch logs for function execution issues

### Option 2: Manual Testing with curl

#### 1. Register a User

```bash
curl -X POST \
  https://YOUR_API_ENDPOINT/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "test@example.com",
    "password": "TestPassword123!",
    "email": "test@example.com"
  }'
```

#### 2. Login to Get Authentication Token

```bash
curl -X POST \
  https://YOUR_API_ENDPOINT/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "test@example.com",
    "password": "TestPassword123!"
  }'
```

Save the `idToken` from the response.

#### 3. Test API Endpoints

Replace `YOUR_ID_TOKEN` with the token from the previous step.

**Create a Note:**
```bash
curl -X POST \
  https://YOUR_API_ENDPOINT/api/v1/notes \
  -H 'Authorization: Bearer YOUR_ID_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Test Note",
    "content": "This is a test note",
    "tags": ["test", "api"]
  }'
```

**List Notes:**
```bash
curl -X GET \
  https://YOUR_API_ENDPOINT/api/v1/notes \
  -H 'Authorization: Bearer YOUR_ID_TOKEN'
```

**Create an Album:**
```bash
curl -X POST \
  https://YOUR_API_ENDPOINT/api/v1/albums \
  -H 'Authorization: Bearer YOUR_ID_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Test Album",
    "description": "This is a test album"
  }'
```

**List Albums:**
```bash
curl -X GET \
  https://YOUR_API_ENDPOINT/api/v1/albums \
  -H 'Authorization: Bearer YOUR_ID_TOKEN'
```

### Option 3: Using Postman

1. Create a new request collection in Postman
2. Set up environment variables for:
   - `api_endpoint`: Your API Gateway URL
   - `id_token`: The authentication token (after login)
3. Create requests for each endpoint, using the environment variables

## Available Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register a new user
- `POST /api/v1/auth/login` - Login and get tokens
- `GET /api/v1/auth/verify-token` - Verify a token
- `POST /api/v1/auth/signout` - Sign out
- `POST /api/v1/auth/confirm-signup` - Confirm signup
- `POST /api/v1/auth/resend-confirmation-code` - Resend confirmation code
- `POST /api/v1/auth/forgot-password` - Initiate forgot password flow
- `POST /api/v1/auth/confirm-forgot-password` - Complete forgot password flow

### Notes
- `POST /api/v1/notes` - Create a note
- `GET /api/v1/notes` - List all notes
- `GET /api/v1/notes/{id}` - Get a specific note
- `PUT /api/v1/notes/{id}` - Update a note
- `DELETE /api/v1/notes/{id}` - Delete a note
- `GET /api/v1/notes/search` - Search notes
- `GET /api/v1/notes/tags/{tag}` - List notes by tag

### Albums
- `POST /api/v1/albums` - Create an album
- `GET /api/v1/albums` - List all albums
- `GET /api/v1/albums/{albumId}` - Get a specific album
- `PUT /api/v1/albums/{albumId}` - Update an album
- `DELETE /api/v1/albums/{albumId}` - Delete an album
- `POST /api/v1/albums/{albumId}/photos` - Add a photo to an album
- `DELETE /api/v1/albums/{albumId}/photos/{photoId}` - Remove a photo from an album

### Bookmarks
- `POST /api/v1/bookmarks` - Create a bookmark
- `GET /api/v1/bookmarks` - List all bookmarks
- `GET /api/v1/bookmarks/{id}` - Get a specific bookmark
- `PUT /api/v1/bookmarks/{id}` - Update a bookmark
- `DELETE /api/v1/bookmarks/{id}` - Delete a bookmark
- `GET /api/v1/bookmarks/search` - Search bookmarks
- `GET /api/v1/bookmarks/tags/{tag}` - List bookmarks by tag

Additional endpoints are available for other resources like files, folders, photos, etc.

## Troubleshooting

### API Gateway Issues

1. **CORS errors**: If you're calling the API from a browser and see CORS errors:
   - Check that your API Gateway has CORS enabled
   - Ensure the appropriate headers are being returned

2. **Authentication failures**:
   - Verify that the Cognito authorizer is correctly configured in API Gateway
   - Check that the token being passed has the correct format
   - Ensure the token hasn't expired

3. **"Unauthorized" errors**:
   - Check that the Lambda functions have the correct permissions
   - Verify that the API Gateway routes are correctly configured
   - Ensure the Cognito User Pool and Client ID are correct
   - Check for double slashes in your API endpoint URL (e.g., `/Prod//api/v1/auth/register`)

4. **Double slash in URLs**:
   - Make sure your API_ENDPOINT variable doesn't end with a trailing slash
   - Correct format: `https://example.execute-api.region.amazonaws.com/Prod`
   - Incorrect format: `https://example.execute-api.region.amazonaws.com/Prod/`

5. **"Internal server error" (502) responses**:
   - This often indicates that the Lambda function is failing to execute properly
   - Check CloudWatch logs for detailed error information
   - Verify that the Lambda function has the necessary permissions to access resources like DynamoDB
   - Use the `add-dynamodb-permissions.sh` script to add DynamoDB permissions to the Lambda execution role:
     ```bash
     chmod +x add-dynamodb-permissions.sh
     ./add-dynamodb-permissions.sh
     ```
   - Wait a few minutes for the permissions to propagate before testing again

### Cognito Issues

1. **"User pool does not exist" errors**:
   - Verify the User Pool ID in the AWS Console
   - Check if the User Pool was created in a different region
   - Ensure your AWS CLI is configured with the correct credentials and region

2. **"User pool client does not exist" errors**:
   - Verify the Client ID in the AWS Console
   - Make sure the Client ID belongs to the specified User Pool
   - Check if the Client was deleted or not created properly

3. **Authentication flow issues**:
   - Verify that the Client is configured to allow the USER_PASSWORD_AUTH flow
   - Check that the Client doesn't have a client secret if you're authenticating from a browser
   - Ensure the Client has the necessary OAuth scopes enabled

### Lambda Function Issues

1. **Function timeouts**:
   - Check CloudWatch logs for execution details
   - Consider increasing the function timeout in the template

2. **Permission errors**:
   - Verify that the Lambda execution role has the necessary permissions
   - Check that the KMS key permissions are correctly configured
   - **Missing DynamoDB permissions**: By default, the Lambda execution role only has permissions for CloudWatch Logs
   - To add DynamoDB permissions, run the `add-dynamodb-permissions.sh` script:
     ```bash
     chmod +x add-dynamodb-permissions.sh
     ./add-dynamodb-permissions.sh
     ```
   - This script creates an IAM policy with DynamoDB permissions and attaches it to the Lambda execution role
   - Wait a few minutes for the permissions to propagate before testing again

3. **Runtime errors**:
   - Review CloudWatch logs for detailed error messages
   - Test the functions locally using SAM CLI: `sam local invoke FunctionName`

### DynamoDB Issues

1. **Table access errors**:
   - Verify that the Lambda execution role has permissions to access the tables
   - Check that the table names in the environment variables match the actual table names

2. **Query/scan performance**:
   - Consider adding indexes for frequently queried attributes
   - Review your access patterns and table design

### Deployment Issues

1. **CloudFormation stack failures**:
   - Check the CloudFormation events for detailed error messages
   - Verify that all required parameters are provided
   - Ensure you have the necessary permissions to create all resources

2. **SAM CLI errors**:
   - Update to the latest version of SAM CLI
   - Check that your template follows the SAM specification
   - Verify that your AWS credentials are correctly configured