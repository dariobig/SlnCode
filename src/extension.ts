'use strict';

import * as vscode from 'vscode';
import Solution, {Project} from './solution';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const guid = require('uuid/v4');
    
    let cloneProjectsCmd = vscode.commands.registerTextEditorCommand('slncode.cloneProject', editor => {
        let content = editor.document.getText();
        if (content === null) {
            return;
        }

        Solution.parse(content).then(solution => {
            let options = solution.projects
                // Remove folders
                .filter(p => { return p.projectPath !== p.projectName; })
                .map(p => {
                    return {
                        label: p.projectName,
                        detail: p.projectPath,
                        description: p.projectGuid,
                    };
                });
            
            vscode.window.showQuickPick(options).then(selected => {
                if (selected === undefined || selected.description === null) {
                    return;
                }

                let o: vscode.InputBoxOptions = {
                    value: `${selected.label}-copy`,
                    prompt: 'name the new project (no spaces)',
                    validateInput: (s) => { return s.indexOf(' ') < 0 ? null : 'project name cannot include spaces'; }
                };
                
                vscode.window.showInputBox(o).then(projectName => {
                    if (projectName === undefined) {
                        return;
                    }

                    editor.edit(eb => {
                        let basePath = path.dirname(editor.document.uri.fsPath);
                        if (!cloneProject(eb, solution, selected.description as string, projectName, basePath)) {
                            vscode.window.showErrorMessage(`can't clone project ${JSON.stringify(selected)}`);
                        }
                    });
                });
            });
        });
    });

    context.subscriptions.push(cloneProjectsCmd);

    function cloneProject(
        edit: vscode.TextEditorEdit, 
        solution: Solution, 
        projectGuid: string, 
        projectName: string,
        solutionPath: string): boolean {

        let project = solution.projects.find(p => p.projectGuid === projectGuid);
        if (project === undefined) {
            return false;
        }

        let configs = solution.configPlatforms.get(projectGuid);
        if (configs === undefined) {
            return false;
        }

        const newGuid: string = guid().toUpperCase();
        
        // Clone project definition
        let newProject = `Project("{${project.solutionGuid}}") = "${projectName}", ` +
            `"${relativeProjectPath(projectName)}", "{${newGuid}}" \nEndProject\n`;
        edit.insert(new vscode.Position(project.lineNumber + 1, 0), newProject);

        // Clone configs
        let lastLine = configs.map(c => c.line).reduce((a, b) => Math.max(a, b), 0);
        let newConfigs = configs.map(c => c.toString(newGuid)).join('\n');
        edit.insert(new vscode.Position(lastLine + 1, 0), newConfigs + '\n');
        
        // Clone folder assignments
        if (solution.folders !== null && solution.foldersSection !== null) {
            let mapping = solution.folders.newProjectMapping(project.projectGuid, newGuid);
            if (mapping !== undefined) {
                edit.insert(new vscode.Position(solution.foldersSection.end, 0), mapping);
            }
        }

        cloneProjectFolder(solutionPath, project, projectName, newGuid);

        return true;
    }

    function relativeProjectPath(projectName: string): string {
        return `${projectName}\\${projectName}.csproj`;
    }

    function replaceAll(text: string, original: string, replacement: string): string {
        return text.split(original).join(replacement);
    }

    function cloneProjectFolder(basePath: string, project: Project, newName: string, newGuid: string): boolean {
        try {
            let newProjectDir = path.join(basePath, newName);
            let newProjectPath = path.join(basePath, relativeProjectPath(newName));

            if (!fs.existsSync(newProjectDir)){
                fs.mkdirSync(newProjectDir);
            }
            
            fs.writeFileSync(newProjectPath, '', 'utf8');

            let oldProjectPath = path.join(basePath, project.projectPath);
            if (!fs.existsSync(oldProjectPath)) {
                return false;
            }

            // Look for files referenced within old project file and copy them over.
            let content = fs.readFileSync(oldProjectPath, 'utf8');
            let oldProjectDir = path.dirname(oldProjectPath);
            fs.readdirSync(oldProjectDir).forEach((name) => {
                let p = path.join(oldProjectDir, name);
                if (fs.statSync(p).isFile() && content.indexOf(p) >= 0) {
                    return;
                }
                
                // Copy files asynchronously
                fs.readFile(p, 'utf8', (err, data) => {
                    if (!err) {
                        // Replace references in project file
                        if (p === oldProjectPath) {
                            data = replaceAll(data, project.projectGuid, newGuid);
                            data = replaceAll(data, oldProjectPath, newProjectPath);
                            data = replaceAll(data, oldProjectDir, newProjectDir);
                            data = replaceAll(data, project.projectName, newName);
                            fs.writeFileSync(path.join(newProjectDir, path.basename(newProjectPath)), data);
                        } else {
                            fs.writeFileSync(path.join(newProjectDir, name), data);
                        }
                    }
                });
            });
        } catch (e) {
            vscode.window.showErrorMessage(e.toString());
            return false;
        }

        return true;
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
}