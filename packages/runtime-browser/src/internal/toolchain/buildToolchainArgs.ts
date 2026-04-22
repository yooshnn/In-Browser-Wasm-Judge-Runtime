import type { ToolchainLayout } from './resolveToolchainLayout.js';

export function buildClangArgs(
  layout: ToolchainLayout,
  sourcePath: string,
  objectPath: string,
  flags: string[],
): string[] {
  return [
    `--target=${layout.target}`,
    '--sysroot=/sysroot',
    '-resource-dir', layout.resourceDir,
    '-isystem', layout.cxxIncludeDir,
    '-isystem', layout.sysIncludeDir,
    '-std=c++17',
    '-fno-finite-loops',
    '-x', 'c++',
    '-c', sourcePath,
    '-o', objectPath,
    '-O1',
    '-fno-exceptions',
    ...flags,
  ];
}

export function buildLdArgs(
  layout: ToolchainLayout,
  objectPath: string,
  outputPath: string,
): string[] {
  return [
    objectPath,
    layout.crt1Path,
    layout.builtinsPath,
    '-L' + layout.libDir,
    '-lc',
    '-lc++',
    '-lc++abi',
    '-o', outputPath,
  ];
}
