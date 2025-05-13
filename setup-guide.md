# Project Setup and Deployment Guide

This guide provides instructions for setting up the project environment, addressing critical issues, and deploying the backend application using AWS SAM (Serverless Application Model).

**IMPORTANT NOTE:** As detailed in the `validation_report.md` (included in this archive), the project currently has critical issues that **MUST** be resolved before attempting deployment. These include missing `CodeUri` properties in the `template.yaml` file and missing Lambda handler source code files.

## 1. Prerequisites

Before you begin, ensure you have the following installed and configured:

*   **AWS Command Line Interface (AWS CLI)**: Version 2.x recommended. (Installation guide: [https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
    *   Configured with appropriate AWS credentials and a default region. Run `aws configure` if you haven't already.
*   **AWS SAM Command Line Interface (SAM CLI)**: (Installation guide: [https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html))
*   **Node.js and npm**: Version 18.x or later recommended for Lambda functions. (Download: [https://nodejs.org/](https://nodejs.org/))
*   **Python**: Version 3.9 or later (if you intend to run or inspect the utility Python scripts included, though they are not directly part of the deployment flow for the end-user).
*   **A ZIP utility**: To extract the project archive.

## 2. Unzipping the Archive

1.  Download the `manus_project_archive.zip` file.
2.  Extract its contents to a local directory on your machine. This will create a `project_archive_staging` folder containing the project files.

## 3. Project Structure Overview

After extraction, you will find the following key files and directories within `project_archive_staging`:

*   `backend_project/`:
    *   `src/`: Contains the source code for all Lambda functions, organized by module (e.g., `auth`, `notes`, `bookmarks`).
    *   `iac_templates/`: Contains the Infrastructure as Code SAM template.
        *   `template.yaml`: The main AWS SAM template file defining your serverless application resources (API Gateway, Lambda functions, DynamoDB tables, etc.).
*   `api_alignment_plan.md`: Document outlining the API design and alignment (for reference).
*   `todo.md`: Task tracking document used during development (for reference).
*   `validation_report.md`: **CRITICAL DOCUMENT** detailing the current issues with the SAM template and Lambda handlers that need to be fixed before deployment.
*   `fix_gsi_simpletable_ruamel.py`: Utility script used during development to fix an issue in the SAM template (for reference).
*   `verify_references.py`: Utility script used during development to check Lambda references (for reference).

**Note:** The script `modify_sam_template.py` was not found during the archival process and is therefore not included.

## 4. Addressing Critical Issues (MANDATORY BEFORE DEPLOYMENT)

As highlighted in `validation_report.md`, you **must** address the following before attempting to build or deploy the application:

### 4.1. Add Missing `CodeUri` Properties in `template.yaml`

Many Lambda function definitions in `/backend_project/iac_templates/template.yaml` are missing the `CodeUri` property. This property tells SAM where to find the source code for each function.

*   **Action**: Open `template.yaml` and for each `AWS::Serverless::Function` resource that is missing `CodeUri` (or has an incorrect one), add or correct it. The `CodeUri` should be a relative path from the `template.yaml` file to the directory containing the function's code.

    *Example*: If `template.yaml` is in `backend_project/iac_templates/` and your `registerUser` Lambda code is in `backend_project/src/auth/`, the `CodeUri` for the `RegisterUserFunction` would be `../src/auth/`.

    ```yaml
    Resources:
      RegisterUserFunction:
        Type: AWS::Serverless::Function
        Properties:
          FunctionName: !Sub "${ProjectName}-registerUser-${StageName}"
          Handler: registerUser.handler # Assuming registerUser.js with exports.handler
          Runtime: nodejs18.x
          CodeUri: ../src/auth/ # <--- ADD/CORRECT THIS LINE
          # ... other properties (MemorySize, Timeout, Policies, Environment, Events)
    ```

    Refer to `validation_report.md` for a list of affected functions.

### 4.2. Create/Populate Missing Lambda Handler Files

Many Lambda handler files (the actual `.js` files containing your function logic) are missing from the `backend_project/src/` subdirectories, or the directories themselves might be empty.

*   **Action**: For every Lambda function defined in `template.yaml`:
    1.  Ensure the directory specified in its `CodeUri` (from step 4.1) exists (e.g., `backend_project/src/auth/`).
    2.  Ensure the JavaScript file specified in its `Handler` property (e.g., `registerUser.js` if Handler is `registerUser.handler`) exists within that `CodeUri` directory.
    3.  The JavaScript file must export a function matching the handler method (e.g., `exports.handler = async (event) => { ... };`).

    Refer to `validation_report.md` and the `ls -R` output within it for details on missing files/directories.

## 5. Environment Setup (AWS Credentials)

Ensure your AWS CLI is configured with the necessary credentials and default region. These credentials must have permissions to create the resources defined in `template.yaml` (IAM roles, Lambda functions, API Gateway, DynamoDB tables, S3 buckets for uploads, KMS keys etc.).

```bash
aws configure
```

Follow the prompts to set your Access Key ID, Secret Access Key, Default region name, and Default output format.

## 6. Building the SAM Application

Once you have addressed the critical issues (Step 4), you can build your SAM application. The `sam build` command processes your SAM template, resolves dependencies for your Lambda functions (e.g., `npm install` if `package.json` is present in function directories), and prepares the artifacts for deployment in the `.aws-sam/build` directory.

Navigate to the directory containing `template.yaml` (i.e., `project_archive_staging/backend_project/iac_templates/`) and run:

```bash
cd /path/to/your/project_archive_staging/backend_project/iac_templates/
sam build
```

If your Lambda functions have `package.json` files for dependencies, `sam build` will attempt to install them. Ensure Node.js and npm are correctly installed and in your system's PATH.

## 7. Deploying the SAM Application

After a successful build, you can deploy the application to your AWS account.

### 7.1. Guided Deployment (Recommended for First Time)

For the first deployment, it's recommended to use `sam deploy --guided`:

```bash
sam deploy --guided
```

This will prompt you for several parameters:

*   **Stack Name**: A unique name for your CloudFormation stack (e.g., `manus-backend-dev`).
*   **AWS Region**: The AWS region to deploy to (e.g., `us-east-1`). This should match your configured default or be specified explicitly.
*   **Parameter ProjectName**: (If defined as a Parameter in `template.yaml`, e.g., `ManusProject`). Enter a project name.
*   **Parameter StageName**: (If defined as a Parameter in `template.yaml`, e.g., `dev`). Enter a stage name.
*   **Confirm changes before deploy**: Enter `y` or `n`. It's good practice to review changes.
*   **Allow SAM CLI IAM role creation**: Enter `y`. SAM may need to create IAM roles for deploying resources.
*   **Disable rollback**: Enter `n` (default). This allows CloudFormation to roll back to a previous state if deployment fails.
*   **Save arguments to configuration file**: Enter `y`. This saves your choices to `samconfig.toml` in the `iac_templates` directory, simplifying future deployments.
*   **SAM configuration file**: `samconfig.toml` (default).
*   **SAM configuration environment**: `default` (default).

SAM will then create a CloudFormation changeset and deploy your stack.

### 7.2. Subsequent Deployments

If you saved your configuration during the guided deployment, subsequent deployments can be done with a simpler command from the `iac_templates` directory:

```bash
sam deploy
```

This will use the settings saved in `samconfig.toml`.

## 8. Post-Deployment

After a successful deployment, SAM CLI will output the stack's resources, including the API Gateway endpoint URL.

*   **API Gateway Endpoint**: Look for an output similar to `ApiGatewayEndpoint` or check the AWS CloudFormation console for your stack's outputs. This URL is the base for accessing your deployed API.

    Example: `https://<api_id>.execute-api.<region>.amazonaws.com/<stage_name>/api/v1/`

*   **Testing**: You can use tools like Postman, curl, or your frontend application to test the API endpoints. Remember that many functions are placeholders and will need their actual logic implemented.

## 9. Notes on Included Scripts

The Python scripts included in the archive (`fix_gsi_simpletable_ruamel.py`, `verify_references.py`) were used internally during the development and validation process by the AI agent. They are provided for transparency and context but are **not** required to be run by you for the deployment process, assuming you follow the steps in Section 4 to manually correct the template and code structure.

---

If you encounter any issues during the build or deployment, carefully review the error messages from SAM CLI and check the AWS CloudFormation console for more detailed error logs for your stack.

