#!/usr/bin/env node
import { program } from "commander"
import chalk from "chalk"
import ora from "ora"
import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import open from "open"

import {
	getAppDirectoryPath,
	checkIsNextProject,
	getProjectDirectory,
	getDependenciesFromRepo,
	promptForPackageManager,
	promptForEnvVariables,
	writeEnvVariables,
	promptForBucketRoute,
	getAvailablePort,
} from "./util.js"

const integrateBucketCMS = async () => {
	console.log(chalk.green("Welcome to Bucket CMS! Let's get started...\n\n"))
	let spinner

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

		// Ensure /app/api directory exists
		let apiDir = path.join(appDir, "api")
		if (!fs.existsSync(apiDir)) {
			await fs.mkdir(apiDir)
		}
		apiDir = path.join(appDir, "api", "bucket")

		spinner = ora("Fetching Bucket CMS package dependencies...").start()

		// Get dependencies dynamically
		const repoPackageJsonUrl = "https://raw.githubusercontent.com/johnpolacek/bucket-cms/main/package.json"
		const dependencies = await getDependenciesFromRepo(repoPackageJsonUrl)

		spinner.succeed(`Found ${dependencies.length} dependencies`)

		const packageManager = await promptForPackageManager()

		// Install required dependencies
		spinner.start("Installing dependencies...")
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
		const bucketRoute = await promptForBucketRoute()

		// Copy files from /src/app/bucket of the cloned repo to the chosen route in the target project
		const sourceBucketDir = path.join(tempDir, "src", "app", "bucket")
		const targetBucketDir = path.join(projectDir, bucketRoute)

		spinner.start(`Copying files to ${bucketRoute}...`)
		await fs.ensureDir(targetBucketDir) // Ensure the directory exists before copying
		await fs.copy(sourceBucketDir, targetBucketDir)
		spinner.succeed(`Files copied to ${bucketRoute}.`)

		const sourceApiDir = path.join(tempDir, "src", "app", "api", "bucket")
		spinner.start("Copying bucket api routes to /api directory...")
		await fs.copy(sourceApiDir, apiDir)
		spinner.succeed(`Bucket api routes copied to ${apiDir} directory.`)

		// Cleanup - remove the temporary cloned directory
		await fs.remove(tempDir)

		console.log(chalk.green("\nYour project has been updated with Bucket CMS files"))
		console.log(chalk("\nNext up, let’s connect to your S3 bucket on AWS."))
		console.log(chalk("\nWe will be setting up some local environment variables."))
		console.log(chalk("\nYou can skip and do this later in the UI if you would prefer.\n\n"))

		// Prompt for .env variables
		const envVariables = await promptForEnvVariables()
		if (envVariables.length > 0) {
			await writeEnvVariables(envVariables, projectDir)
		}

		if (envVariables.length === 4) {
			console.log(chalk.green("\nEnvironment variables stored successfully!\nRemember that you will also need to add these to your hosted server environment (Vercel or other)"))
		}

		console.log(chalk.green("\nBucket CMS has been successfully integrated!"))

		const port = await getAvailablePort(3000)
		setTimeout(() => {
			open(`http://localhost:${port}` + bucketRoute.split("/app")[1])
		}, 2000)

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
