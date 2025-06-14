#!/usr/bin/env node

import inquirer from "inquirer";
import * as fs from "fs";

import { dirname, basename } from "path";
import { fileURLToPath } from "url";

import create_directory_content from "./create_directory_content.js";

// * polyfill for es6
const __dirname = dirname(fileURLToPath(import.meta.url));

const CURR_DIR = process.cwd();
const pathToTemplates = `${__dirname}/../templates`;

const CHOICES = fs.readdirSync(pathToTemplates);

const QUESTIONS = [
    {
        name: "project-name",
        type: "input",
        message: "Your Project Name",
        validate: (input) => {
            // * VALIDATE THIS PART
            return true;
        },
    },
    {
        name: "project-choice",
        type: "list",
        message: "What project template would you like",
        choices: CHOICES,
    },
];

inquirer.prompt(QUESTIONS).then((answer) => {
    let project_name = answer["project-name"];
    const project_choice = answer["project-choice"];
    const template_path = `${__dirname}/../templates/${project_choice}`;

    // if (project_name == ".") {
    // 	const new_project_name = basename(CURR_DIR);

    // 	project_name = new_project_name || "kyokatsui";
    // } else {
    // 	fs.mkdirSync(`${CURR_DIR}/${project_name}`);
    // }

    fs.mkdirSync(`${CURR_DIR}/${project_name}`);
    create_directory_content(template_path, project_name);
});
