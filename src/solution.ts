'use strict';

export default class Solution {
    projectsSection: Section;
    projects: Project[];
    configPlatformsSection: Section;
    configPlatforms: Map<string, ConfigPlatform[]>; 
    foldersSection: Section|null = null;
    folders: Folders|null = null;

    constructor(projects: Project[], projectsSection: Section,
        configPlatforms: Map<string, ConfigPlatform[]>, configPlatformsSection: Section,
        folders: Folders|null, foldersSection: Section|null) {
        this.projects = projects;
        this.projectsSection = projectsSection;
        this.configPlatforms = configPlatforms;
        this.configPlatformsSection = configPlatformsSection;
        this.folders = folders;
        this.foldersSection = foldersSection;
    }

    static parse(content: string): Thenable<Solution> {
        return new Promise((resolve, reject) => {
            let configPlatforms: Map<string, ConfigPlatform[]>|null = null;
            let configPlatformsSection: Section|null = null;
            let projectsSection: Section|null = null;
            let projects: Array<Project>|null = null;
            let foldersSection: Section|null = null;
            let folders: Folders|null = null;
            let lines = content.split('\n');
            let commentRE = /^\s*#/;

            for (let i = 0; i < lines.length; ++i) {
                if (commentRE.exec(lines[i])) {
                    continue;
                }

                if (projects === null) {
                    [projectsSection, projects] = Project.extract(lines, i);
                    if (projectsSection !== null) {
                        i = projectsSection.end;
                        continue;
                    }
                }
                
                if (configPlatforms === null) {
                    [configPlatformsSection, configPlatforms] = ConfigPlatform.extract(lines, i);
                    if (configPlatformsSection !== null) {
                        i = configPlatformsSection.end;
                        continue;
                    }
                }

                if (folders === null) {
                    [foldersSection, folders] = Folders.extract(lines, i);
                    if (foldersSection !== null) {
                        i = foldersSection.end;
                        continue;
                    }
                }
            }

            if (configPlatforms !== null && projects !== null) {
                let s = new Solution(projects, projectsSection as Section, 
                    configPlatforms, configPlatformsSection as Section, 
                    folders, foldersSection);
                resolve(s);
            } else {
                reject("couldn't parse solution file!");
            }
        });
    }
}

class Section {
    begin: number;
    end: number;

    constructor(begin: number, end: number) {
        this.begin = begin;
        this.end = end;
    }
}

export class Project {
    lineNumber: number;
    solutionGuid:string;
    projectName:string;
    projectPath:string;
    projectGuid:string;

    constructor(lineNumber: number, solutionGuid:string = '', projectName:string = '', projectPath:string = '', projectGuid:string = '') {
        this.lineNumber = lineNumber;
        this.solutionGuid = solutionGuid;
        this.projectName = projectName;
        this.projectPath = projectPath;
        this.projectGuid = projectGuid;
    }

    static extract(lines: string[], begin: number): [Section, Project[]]|[null, null] {
        // Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "SQILibrary", "SQILibrary\SQILibrary.csproj", "{A5C37F46-8482-4519-94A2-B706DEBD596A}"
        let projectRE = /^\s*Project\s*\(\s*"{([^"]+)}"\s*\)\s*=\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"{([^}]+)}"/;
        let endProjectRE = /^\s*EndProject/;
        let projects = new Array<Project>();
        let endProjects = -1;
        let i = begin;
        let proj: any = null;

        for (; i < lines.length; ++i) {
            let current = lines[i];
            let m = projectRE.exec(current);
            if (m) {
                if (proj !== null) {
                    // new project before endproject
                    return [null, null];
                }

                proj = m;
                endProjects = -1;
                continue;
            } else if (i === begin) {
                return [null, null];
            } else if (endProjectRE.exec(current)) {
                projects.push(new Project(i, proj[1], proj[2], proj[3], proj[4]));
                proj = null;
                endProjects = i;
                continue;
            }
        }

        if (endProjects < 0 || proj !== null) {
            return [null, null];
        }

        return [new Section(begin, endProjects), projects];
    }
}

class ConfigPlatform {
    line: number;
    indent: string;
    projectGuid: string;
    platform: string;
    config: string;
    platformConfig: string;

    constructor(line: number, indent: string, projectGuid: string = '', 
        platform: string = '', config: string = '', platformConfig: string = '') {
        this.line = line;
        this.indent = indent;
        this.projectGuid = projectGuid;
        this.platform = platform;
        this.config = config;
        this.platformConfig = platformConfig;
    }

    toString(guid: string): string {
        return `${this.indent}{${guid}}.${this.platform}.${this.config} = ${this.platformConfig}`;
    }

    static extract(lines: string[], begin: number): [Section, Map<string, ConfigPlatform[]>]|[null, null] {
        // GlobalSection(ProjectConfigurationPlatforms) = postSolution
        if (!/^\s*GlobalSection\(ProjectConfigurationPlatforms\)\s*=\s*postSolution\s*/.exec(lines[begin])) {
            return [null, null];
        }

        let configs = new Map<string, ConfigPlatform[]>();
        let endRE = /^\s*EndGlobalSection/;
        // {FB4CFB33-2D1C-498B-AEF8-4E5E6562D792}.Debug|amd64.ActiveCfg = Debug|amd64
        let configRE = /^(\s*){([^}]+)}\.([^\.]+)\.(\S+)\s*=\s*(.+)\s*/;
        let i = begin + 1;

        for (; i < lines.length; ++i) {
            let current = lines[i];
            if (endRE.exec(current)) {
                break;
            }

            let m = configRE.exec(current);
            if (m === null) {
                continue;
            }

            let guid = m[2];
            let c = configs.get(guid);
            if (c === undefined) {
                c = new Array<ConfigPlatform>();
            }
            c.push(new ConfigPlatform(i, m[1], m[2], m[3], m[4], m[5]));
            configs.set(guid, c);
        }

        return [new Section(begin, i), configs];
    }
}

class Folders {
    mapping: Map<string, string>;
    indent: string;

    constructor(mapping: Map<string, string>, indent: string) {
        this.mapping = mapping;
        this.indent = indent;
    }

    getFolderGuid(projectGuid: string): string|undefined {
        return this.mapping.get(projectGuid);
    }

    newProjectMapping(oldGuid: string, newGuid: string) {
        let folder = this.getFolderGuid(oldGuid);
        return folder === undefined ? undefined : `${this.indent}{${newGuid}} = {${folder}}\n`;
    }

    static extract(lines: string[], begin: number): [Section, Folders]|[null, null] {
        // GlobalSection(NestedProjects) = preSolution
        if (!/^\s*GlobalSection\(NestedProjects\)\s*=\s*preSolution\s*/.exec(lines[begin])) {
            return [null, null];
        }

        let mapping = new Map<string, string>();
        let indent = '';
        let endRE = /^\s*EndGlobalSection/;
        // {<project-guid>} = {<folder-guid>}
        let folderRE = /^(\s*){([^}]+)}\s*=\s*{([^}]+)}/;
        let i = begin + 1;

        for (; i < lines.length; ++i) {
            let current = lines[i];
            if (endRE.exec(current)) {
                break;
            }

            let m = folderRE.exec(current);
            if (m === null) {
                continue;
            }

            indent = m[1];
            let projectGuid = m[2];
            let folderGuid = m[3];
            mapping.set(projectGuid, folderGuid);
        }

        return [new Section(begin, i), new Folders(mapping, indent)];
    }
}


