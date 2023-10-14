#!/usr/bin/env node
import { program } from "commander"
import chalk from "chalk"
import ora from "ora"
import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import open from "open"

import {
  checkLicenseStatus,
  getAppDirectoryPath,
  checkIsNextProject,
  getProjectDirectory,
  getDependenciesFromRepo,
  promptForPackageManager,
  promptForEnvVariables,
  writeEnvVariables,
  getAvailablePort,
} from "./util.js"

const integrateBucketCMS = async () => {
  console.log(chalk.green("Welcome to Bucket CMS! Let's get started...\n\n"))
  let spinner = ora()

  await checkLicenseStatus()

  try {
    const projectDir = await getProjectDirectory()

    if (!projectDir || !checkIsNextProject(projectDir)) {
      console.error(chalk.red("This doesn't seem to be a Next.js project."))
      return
    }

    const appDir = await getAppDirectoryPath(projectDir)
    if (!fs.existsSync(appDir)) {
      console.error(chalk.red("Error: /app directory not found in the provided Next.js project."))
      return
    }
    console.log(chalk.green("Found: " + appDir))

    // Detect the authentication solution used in the project
    const packageJsonPath = path.join(projectDir, "package.json")
    console.log(chalk.green("Reading " + packageJsonPath + "..."))
    const fileContent = await fs.promises.readFile(packageJsonPath, "utf8")
    const packageJson = JSON.parse(fileContent)
    const hasNextAuth = packageJson.dependencies && packageJson.dependencies["next-auth"]
    const hasClerk = packageJson.dependencies && packageJson.dependencies["@clerk/nextjs"]

    if (hasNextAuth) {
      console.log(chalk.green("NextAuth detected."))
    } else if (hasClerk) {
      console.log(chalk.green("Clerk auth detected."))
    } else {
      console.log(chalk.orange("Warning: No auth solution detected."))
      console.log(chalk.orange("Localhost auth bypass will be used."))
      console.log(chalk.orange("Add authentication to use Bucket CMS in production."))
    }

    // Ensure /app/api directory exists
    let apiDir = path.join(appDir, "api")
    if (!fs.existsSync(apiDir)) {
      console.log(chalk.gray("api directory not found, creating new..."))
      await fs.mkdir(apiDir)
      console.log(chalk.green("api directory created"))
    } else {
      console.log(chalk.gray("api directory found"))
    }
    apiDir = path.join(appDir, "api", "bucket")

    spinner.start("Fetching Bucket CMS package dependencies...")

    // Get dependencies dynamically
    const repoPackageJsonUrl = "https://raw.githubusercontent.com/johnpolacek/bucket-cms/main/package.json"
    const repoDependencies = await getDependenciesFromRepo(repoPackageJsonUrl)
    const dependencies = repoDependencies.filter((dep) => dep !== "next-auth").filter((dep) => dep.includes("clerk")) // exclude auth dependencies - that is user-land

    spinner.succeed(`Loaded dependencies`)
    const packageManager = await promptForPackageManager()

    // Install required dependencies
    spinner.start(`Installing ${dependencies.length} dependencies...`)
    await execa(packageManager, ["install", ...dependencies])
    spinner.succeed("Dependencies installed.")

    // Clone the GitHub repo to a temporary directory
    const tempDir = path.join(projectDir, ".bucket-cms-temp")

    // Check if .bucket-cms-temp exists, and if so, delete it
    if (fs.existsSync(tempDir)) {
      await fs.remove(tempDir)
    }

    spinner.start("Cloning the Bucket CMS repository...")
    await execa("git", ["clone", "https://github.com/johnpolacek/bucket-cms.git", tempDir])
    spinner.succeed("Bucket CMS repository cloned.")

    // Prompt for Bucket CMS route
    const bucketRoute = path.join(appDir, "bucket")

    // Copy files from /src/app/bucket of the cloned repo to the chosen route in the target project
    const sourceBucketDir = path.join(tempDir, "src", "app", "bucket")
    const targetBucketDir = path.join(projectDir, bucketRoute)

    spinner.start(`Copying files to ${bucketRoute}...`)
    await fs.ensureDir(targetBucketDir) // Ensure the directory exists before copying
    await fs.copy(sourceBucketDir, targetBucketDir)
    spinner.succeed(`Files copied to ${bucketRoute}.`)

    spinner.start("Copying bucket api routes to /api directory...")
    const sourceApiDir = path.join(tempDir, "src", "app", "api", "bucket")
    await fs.copy(sourceApiDir, apiDir)
    spinner.succeed(`Bucket api routes copied to ${apiDir} directory.`)

    // Replace get-session-user.ts based on the authentication method
    spinner.start(`Configuring auth...`)
    const targetAuthFilePath = path.join(apiDir, "auth", "get-session-user.ts")
    if (hasNextAuth) {
      const sourceAuthFilePath = path.join(tempDir, "src", "app", "api", "bucket", "auth", "next-auth", "get-session-user.ts")
      await fs.copy(sourceAuthFilePath, targetAuthFilePath, { overwrite: true })
      spinner.succeed("Replaced get-session-user.ts with NextAuth version.")
    } else if (hasClerk) {
      const sourceAuthFilePath = path.join(tempDir, "src", "app", "api", "bucket", "auth", "clerk", "get-session-user.ts")
      console.log(chalk.gray("sourceAuthFilePath: " + sourceAuthFilePath))
      console.log(chalk.gray("targetAuthFilePath: " + targetAuthFilePath))
      await fs.copy(sourceAuthFilePath, targetAuthFilePath, { overwrite: true })
      spinner.succeed("Replaced get-session-user.ts with Clerk version.")
    } else {
      const sourceAuthFilePath = path.join(tempDir, "src", "app", "api", "bucket", "auth", "localhost-only", "get-session-user.ts")
      await fs.copy(sourceAuthFilePath, targetAuthFilePath, { overwrite: true })
      spinner.succeed("Replaced get-session-user.ts with localhost bypass.")
    }

    // Remove auth directories
    console.log(chalk.gray("Cleaning up..."))
    const localhostOnlyDir = path.join(tempDir, "src", "app", "api", "bucket", "auth", "localhost-only")
    const nextAuthDir = path.join(tempDir, "src", "app", "api", "bucket", "auth", "next-auth")
    const clerkDir = path.join(tempDir, "src", "app", "api", "bucket", "auth", "clerk")

    await fs.remove(localhostOnlyDir)
    await fs.remove(nextAuthDir)
    await fs.remove(clerkDir)

    // Copy the Bucket CMS logo from the cloned repo to the user's project
    const sourceLogoPath = path.join(tempDir, "public", "bucket-cms-logo.jpg")
    const targetLogoPath = path.join(projectDir, "public", "bucket-cms-logo.jpg")
    await fs.copy(sourceLogoPath, targetLogoPath)

    // Cleanup - remove the temporary cloned directory
    await fs.remove(tempDir)

    console.log(chalk.green("\nYour project has been updated with Bucket CMS files"))
    console.log(chalk("\nNext up, let’s connect to your S3 bucket on AWS."))
    console.log(chalk("\nWe will be setting up some local environment variables."))
    console.log(chalk("\nYou can skip and do this later in the UI if you would prefer.\n\n"))

    // Prompt for .env variables
    const envVariables = await promptForEnvVariables(projectDir)
    await writeEnvVariables(envVariables, projectDir)

    if (envVariables.length === 4) {
      console.log(chalk.green("\nEnvironment variables stored successfully!\nRemember that you will also need to add these to your hosted server environment (Vercel or other)"))
    }

    console.log(chalk.green("\nBucket CMS has been successfully integrated!"))

    const port = await getAvailablePort(3000)
    setTimeout(() => {
      open(`http://localhost:${port}` + bucketRoute.split("/app")[1])
    }, 4000)

    console.log(chalk(`\nStarting up dev server on port ${port}...`))
    await fs.remove(path.join(projectDir, ".next"))
    switch (packageManager) {
      case "yarn":
        await execa("yarn", ["dev"], { stdio: "inherit" })
        break
      case "pnpm":
        await execa("pnpm", ["run", "dev"], { stdio: "inherit" })
        break
      default:
        await execa("npm", ["run", "dev"], { stdio: "inherit" })
    }
  } catch (error) {
    spinner.fail("An error occurred while integrating Bucket CMS.")
    console.error(chalk.red(error))
  }
}

program.action(integrateBucketCMS)

program.parse(process.argv)
