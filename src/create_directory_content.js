import * as fs from "fs";

const CURR_DIR = process.cwd();

const create_directory_content = (template_path, new_project_path) => {
    const filesToCreate = fs.readdirSync(template_path);

    filesToCreate.forEach((file) => {
        const originalFilePath = `${template_path}/${file}`;

        const stats = fs.statSync(originalFilePath);

        if (stats.isFile()) {
            const contents = fs.readFileSync(originalFilePath, "utf-8");

            // Rename
            if (file === ".npmignore") file = ".gitignore";

            const writePath = `${CURR_DIR}/${new_project_path}/${file}`;
            fs.writeFileSync(writePath, contents, "utf-8");
        } else if (stats.isDirectory()) {
            fs.mkdirSync(`${CURR_DIR}/${new_project_path}/${file}`);

            // recurcive call
            create_directory_content(
                `${template_path}/${file}`,
                `${new_project_path}/${file}`
            );
        }
    });
};

export default create_directory_content;
