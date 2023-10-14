import net from "net"
import fs from "fs-extra"
import inquirer from "inquirer"
import path from "path"
import axios from "axios"
import chalk from "chalk"

export const getDependenciesFromRepo = async (repoUrl) => {
  try {
    const response = await axios.get(repoUrl)
    const packageJson = response.data
    return Object.keys(packageJson.dependencies || {})
  } catch (error) {
    console.error(chalk.red("Error fetching dependencies from GitHub repo."))
    throw error
  }
}

export const promptForPackageManager = async () => {
  const questions = [
    {
      type: "list",
      name: "packageManager",
      message: "Which package manager would you like to use?",
      choices: ["pnpm", "yarn", "npm"],
      default: "pnpm",
    },
  ]

  const answers = await inquirer.prompt(questions)
  return answers.packageManager
}

export const checkIsNextProject = (dir) => {
  const requiredFiles = ["package.json", "next.config.js"]
  return requiredFiles.every((file) => fs.existsSync(path.join(dir, file)))
}

export const getProjectDirectory = async () => {
  const questions = [
    {
      type: "input",
      name: "projectDir",
      default: "./",
      message: "Please enter the path to your Next.js project directory:",
      validate: (inputPath) => {
        if (checkIsNextProject(inputPath)) {
          return true
        }
        return "Provided path doesn't seem to be a Next.js project. Please enter a valid path."
      },
    },
  ]

  const answers = await inquirer.prompt(questions)
  return answers.projectDir
}

export const findAppDirectory = async (dir) => {
  console.log(chalk("Searching for /app directory path..."))
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "app") {
        return path.join(dir, entry.name)
      } else {
        const nestedPath = await findAppDirectory(path.join(dir, entry.name))
        if (nestedPath) {
          return nestedPath
        }
      }
    }
  }
  return null
}

export const getAppDirectoryPath = async (startDir) => {
  const dirsToCheck = [startDir]

  while (dirsToCheck.length > 0) {
    const dir = dirsToCheck.pop()
    const items = await fs.readdir(dir, { withFileTypes: true })

    for (const item of items) {
      if (item.isDirectory()) {
        const fullPath = path.join(dir, item.name)
        if (item.name === "app") {
          return fullPath
        } else {
          dirsToCheck.push(fullPath)
        }
      }
    }
  }

  return null // Return null if /app directory is not found
}

export const getProjectName = async (projectDir) => {
  try {
    const packageJsonPath = path.join(projectDir, "package.json")
    const packageJsonData = await fs.readJson(packageJsonPath)
    return packageJsonData.name || ""
  } catch (error) {
    console.error(chalk.red("Could not retrieve project name."))
    throw error
  }
}

export const slugify = (str) => {
  return str
    .toString()
    .toLowerCase()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w\-]+/g, "") // Remove all non-word characters
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start of text
    .replace(/-+$/, "") // Trim - from end of text
}

export const promptForEnvVariables = async (projectDir) => {
  // Get the project name, slugify it, and append -bucket-cms to create the default bucket name
  const projectName = await getProjectName(projectDir)
  const defaultBucketName = slugify(projectName) + "-bucket-cms"

  const questions = [
    {
      type: "input",
      name: "AWS_ACCESS_KEY_ID",
      message: "Enter AWS Access Key ID (optional, press enter to skip):",
    },
    {
      type: "input",
      name: "AWS_SECRET_ACCESS_KEY",
      message: "Enter AWS Secret Access Key (optional, press enter to skip):",
    },
    {
      type: "input",
      name: "AWS_REGION",
      message: "Enter AWS Region (e.g., us-west-1) (optional, press enter to skip):",
    },
    {
      type: "input",
      name: "AWS_S3_BUCKET_NAME",
      message: "Enter S3 Bucket Name:",
      default: defaultBucketName,
    },
    {
      type: "input",
      name: "OPENAI_API_KEY",
      message: "Enter your OpenAI Key if you’d like to use AI to build React Components (optional, press enter to skip):",
    },
  ]

  return await inquirer.prompt(questions)
}

export const writeEnvVariables = async (envVariables, projectDir) => {
  const envPath = path.join(projectDir, ".env.local")
  const envData = Object.entries(envVariables)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")

  if (fs.existsSync(envPath)) {
    // Append to the file if it exists
    console.log("appending environment variables at " + envPath)
    await fs.appendFile(envPath, "\n" + envData)
  } else {
    // Create the file if it doesn't exist
    console.log("writing environment variables at " + envPath)
    await fs.writeFile(envPath, envData)
  }
}

export const getAvailablePort = (startPort) => {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(startPort, () => {
      const port = server.address().port
      server.close(() => {
        resolve(port)
      })
    })
    server.on("error", () => {
      resolve(getAvailablePort(startPort + 1))
    })
  })
}

export const checkLicenseStatus = async () => {
  const { isCommercial } = await inquirer.prompt([
    {
      type: "confirm",
      name: "isCommercial",
      message: "Is your project commercial?",
      default: false,
    },
  ])

  if (!isCommercial) {
    console.log(chalk.green("Bucket CMS is free for non-commercial projects!"))
    console.log(chalk.blue("For more details, check the license on GitHub: https://github.com/johnpolacek/bucket-cms/blob/main/LICENSE"))
    return true
  } else {
    const { agreeToPay } = await inquirer.prompt([
      {
        type: "confirm",
        name: "agreeToPay",
        message: "Do you agree to purchase a license for Bucket CMS once you start collecting revenue from your project?",
        default: false,
      },
    ])
    if (agreeToPay) {
      console.log(chalk.green("Thank you for your understanding and support! Please remember to purchase a license once you start collecting revenue."))
      return true
    } else {
      console.log(
        chalk.yellow(
          "To use Bucket CMS for commercial projects, you are required to purchase a license once you start collecting revenue. Please revisit the licensing terms at: https://bucket-cms.com/license"
        )
      )
      return false
    }
  }
}
