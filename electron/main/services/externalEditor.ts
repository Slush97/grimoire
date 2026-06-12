// Open a file in the user's chosen text editor. The OS default-app route
// (shell.openPath) is a poor fit for gameinfo.gi: .gi resolves to text/plain,
// which on many desktops maps to a word processor (LibreOffice Writer), so
// the user picks an editor once (stored in settings.externalEditorPath) and
// we spawn it directly. Only real executables are offered: Windows launcher
// shims like code.cmd need a shell and break on paths with spaces.
import { spawn } from 'child_process';
import { accessSync, constants, existsSync } from 'fs';
import { delimiter, join } from 'path';
import { shell } from 'electron';
import type { EditorCandidate } from '../../../src/types/electron';

function which(cmd: string): string | null {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        if (!dir) continue;
        const full = join(dir, cmd);
        try {
            accessSync(full, constants.X_OK);
            return full;
        } catch {
            // not here; keep scanning
        }
    }
    return null;
}

const LINUX_CANDIDATES: Array<[command: string, name: string]> = [
    ['gnome-text-editor', 'GNOME Text Editor'],
    ['gedit', 'gedit'],
    ['kate', 'Kate'],
    ['kwrite', 'KWrite'],
    ['mousepad', 'Mousepad'],
    ['pluma', 'Pluma'],
    ['geany', 'Geany'],
    ['code', 'Visual Studio Code'],
    ['codium', 'VSCodium'],
    ['cursor', 'Cursor'],
    ['subl', 'Sublime Text'],
];

function windowsCandidates(): Array<[path: string, name: string]> {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    const winDir = process.env['WINDIR'] ?? 'C:\\Windows';
    return [
        [join(winDir, 'System32', 'notepad.exe'), 'Notepad'],
        [join(programFiles, 'Notepad++', 'notepad++.exe'), 'Notepad++'],
        [join(programFilesX86, 'Notepad++', 'notepad++.exe'), 'Notepad++'],
        [join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'), 'Visual Studio Code'],
        [join(programFiles, 'Microsoft VS Code', 'Code.exe'), 'Visual Studio Code'],
        [join(programFiles, 'Sublime Text', 'sublime_text.exe'), 'Sublime Text'],
    ];
}

export function listEditorCandidates(): EditorCandidate[] {
    const found: EditorCandidate[] = [];
    if (process.platform === 'win32') {
        for (const [path, name] of windowsCandidates()) {
            if (existsSync(path)) found.push({ name, path });
        }
    } else {
        for (const [command, name] of LINUX_CANDIDATES) {
            const path = which(command);
            if (path) found.push({ name, path });
        }
    }
    // The same editor can be detected at two install paths; keep the first.
    const seen = new Set<string>();
    return found.filter((c) => !seen.has(c.name) && seen.add(c.name));
}

/** Open filePath with the chosen editor binary, or the OS default app when
 *  editorPath is null/undefined. Throws with a user-facing message. */
export async function openInEditor(
    filePath: string,
    editorPath: string | null | undefined
): Promise<void> {
    if (editorPath) {
        if (!existsSync(editorPath)) {
            throw new Error(
                'The configured editor no longer exists. Pick a different one via "change editor".'
            );
        }
        await new Promise<void>((resolve, reject) => {
            const child = spawn(editorPath, [filePath], { detached: true, stdio: 'ignore' });
            child.once('spawn', () => {
                child.unref();
                resolve();
            });
            child.once('error', (err) => reject(new Error(`Could not launch editor: ${err.message}`)));
        });
        return;
    }
    const error = await shell.openPath(filePath);
    if (error) {
        // No association for the file type: at least reveal it.
        shell.showItemInFolder(filePath);
    }
}
