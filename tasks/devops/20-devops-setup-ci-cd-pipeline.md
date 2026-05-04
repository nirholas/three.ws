---
status: not-started
---
# Prompt 20: Setup CI/CD Pipeline

**Status:** Not Started

## Objective
Automate the testing, building, and deployment of the application using a CI/CD pipeline. This will improve development velocity and reduce the risk of manual deployment errors.

## Explanation
A Continuous Integration/Continuous Deployment (CI/CD) pipeline automates the steps required to get your code from a commit into production. We will use GitHub Actions for this, as it's tightly integrated with our source control.

## Instructions
1.  **Create a GitHub Actions Workflow:**
    *   Create a new file at `.github/workflows/deploy.yml`.
    *   This file will define the jobs and steps for our pipeline.
2.  **Define the Trigger:**
    *   Configure the workflow to run on every `push` to the `main` branch.
3.  **Setup the Environment:**
    *   Use the `actions/checkout@v3` action to check out the code.
    *   Use the `actions/setup-node@v3` action to set up the correct Node.js version (as defined in `package.json`).
4.  **Define the Jobs:**
    *   **`test` job:**
        *   Install dependencies (`npm install`).
        *   Run Prettier check (`npm run format:check` -- you'll need to create this script).
        *   Run linter (`npm run lint`).
        *   Run unit/integration tests (`npm test`).
    *   **`build` job:**
        *   This job should `need` the `test` job to complete successfully.
        *   Install dependencies (`npm install`).
        *   Run the production build (`npm run build:all`).
        *   Upload the `dist` directory as a build artifact.
    *   **`deploy` job:**
        *   This job should `need` the `build` job.
        *   Download the build artifact.
        *   Use the Vercel CLI or a Vercel GitHub Action to deploy the contents of the `dist` directory to production.
        *   You will need to add a `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` as secrets to your GitHub repository.

## Example Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run verify # Assumes 'verify' script runs prettier, linter, tests

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:all
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
      - name: Deploy to Vercel
        run: npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
        # Add more vercel-cli flags as needed, or use a dedicated action
```
