import ansis from "ansis";

function shouldUseColors(): boolean {
  return process.stdout.isTTY === true;
}

export const colors = {
  red: (str: string): string => (shouldUseColors() ? ansis.red(str) : str),
  green: (str: string): string => (shouldUseColors() ? ansis.green(str) : str),
  yellow: (str: string): string => (shouldUseColors() ? ansis.yellow(str) : str),
  blue: (str: string): string => (shouldUseColors() ? ansis.blue(str) : str),
  gray: (str: string): string => (shouldUseColors() ? ansis.gray(str) : str),
  dim: (str: string): string => (shouldUseColors() ? ansis.dim(str) : str),
  bold: (str: string): string => (shouldUseColors() ? ansis.bold(str) : str),
  cyan: (str: string): string => (shouldUseColors() ? ansis.cyan(str) : str),

  get red_bold() {
    return (str: string): string => (shouldUseColors() ? ansis.red.bold(str) : str);
  },
  get bold_yellow() {
    return (str: string): string => (shouldUseColors() ? ansis.bold.yellow(str) : str);
  },
  get bold_blue() {
    return (str: string): string => (shouldUseColors() ? ansis.bold.blue(str) : str);
  },
  get bold_green() {
    return (str: string): string => (shouldUseColors() ? ansis.bold.green(str) : str);
  },
};

export function isColorSupported(): boolean {
  return shouldUseColors();
}
