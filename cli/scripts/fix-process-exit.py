#!/usr/bin/env python3
"""
Fix all process.exit() calls in DR CLI commands

This script automates the conversion from direct process.exit() calls
to proper CLIError throws, ensuring telemetry is properly flushed.
"""

import re
import sys
from pathlib import Path


def has_clierror_import(content: str) -> bool:
    """Check if file already imports CLIError"""
    return "import { CLIError }" in content or "import type { CLIError }" in content


def add_clierror_import(content: str) -> str:
    """Add CLIError import if not present"""
    if has_clierror_import(content):
        return content

    # Find the last import statement
    import_pattern = r"^import\s+.*?;$"
    imports = list(re.finditer(import_pattern, content, re.MULTILINE))

    if imports:
        last_import = imports[-1]
        insert_pos = last_import.end()

        # Add CLIError import after last import
        new_import = "\nimport { CLIError } from '../utils/errors.js';"
        content = content[:insert_pos] + new_import + content[insert_pos:]

    return content


def fix_process_exit_in_catch(content: str) -> str:
    """
    Fix process.exit() calls inside catch blocks

    Pattern:
      catch (error) {
        console.error(...);
        process.exit(1);
      }

    Becomes:
      catch (error) {
        if (error instanceof CLIError) {
          throw error;
        }
        throw new CLIError(message, 1);
      }
    """
    # Pattern for catch blocks with process.exit
    pattern = r'catch\s*\(([^)]+)\)\s*\{([^}]*?)console\.error\([^)]*\);([^}]*?)process\.exit\((\d+)\);([^}]*?)\}'

    def replace_catch(match):
        error_var = match.group(1)
        before_console = match.group(2)
        between = match.group(3)
        exit_code = match.group(4)
        after_exit = match.group(5)

        # Extract message from error variable
        return f'''catch ({error_var}) {{
      if ({error_var} instanceof CLIError) {{
        throw {error_var};
      }}
      const message = {error_var} instanceof Error ? {error_var}.message : String({error_var});
      throw new CLIError(message, {exit_code});
    }}'''

    content = re.sub(pattern, replace_catch, content, flags=re.DOTALL)
    return content


def fix_simple_error_exit(content: str) -> str:
    """
    Fix simple error patterns

    Pattern:
      console.error(ansis.red('Error: ...'));
      process.exit(1);

    Becomes:
      throw new CLIError('...', 1);
    """
    pattern = r'console\.error\(ansis\.red\([\'"]Error:\s*([^\'"]+)[\'"]\)\);[\s]*process\.exit\((\d+)\);'

    def replace_error(match):
        message = match.group(1)
        exit_code = match.group(2)
        return f"throw new CLIError('{message}', {exit_code});"

    content = re.sub(pattern, replace_error, content)
    return content


def fix_success_exit(content: str) -> str:
    """
    Fix success path exits

    Pattern:
      process.exit(0);

    Becomes:
      return;
    """
    # Only replace process.exit(0) when it's not in a comment
    pattern = r'process\.exit\(0\);'
    content = re.sub(pattern, 'return;', content)
    return content


def fix_file(file_path: Path) -> bool:
    """Fix a single file, return True if changes were made"""
    print(f"Processing {file_path}...")

    content = file_path.read_text()
    original = content

    # Check if file has process.exit calls
    if 'process.exit(' not in content:
        print(f"  ✓ No process.exit() found")
        return False

    # Add CLIError import if needed
    content = add_clierror_import(content)

    # Fix different patterns
    content = fix_success_exit(content)
    content = fix_simple_error_exit(content)
    content = fix_process_exit_in_catch(content)

    # Check if any process.exit remains
    remaining = content.count('process.exit(')

    if content != original:
        file_path.write_text(content)
        print(f"  ✅ Fixed ({remaining} remaining)")
        return True
    else:
        print(f"  ⚠️  No changes made ({remaining} remaining)")
        return False


def main():
    """Main entry point"""
    cli_dir = Path(__file__).parent.parent
    commands_dir = cli_dir / "src" / "commands"

    if not commands_dir.exists():
        print(f"Error: Commands directory not found: {commands_dir}")
        sys.exit(1)

    print(f"Fixing commands in {commands_dir}\n")

    files_changed = 0
    files_processed = 0

    for ts_file in commands_dir.glob("*.ts"):
        files_processed += 1
        if fix_file(ts_file):
            files_changed += 1

    print(f"\n📊 Summary:")
    print(f"   Files processed: {files_processed}")
    print(f"   Files changed: {files_changed}")
    print(f"   Files unchanged: {files_processed - files_changed}")

    # Check for remaining process.exit calls
    print(f"\n🔍 Checking for remaining process.exit() calls...")
    remaining_files = []
    for ts_file in commands_dir.glob("*.ts"):
        content = ts_file.read_text()
        count = content.count('process.exit(')
        if count > 0:
            remaining_files.append((ts_file.name, count))

    if remaining_files:
        print(f"\n⚠️  Files with remaining process.exit() calls:")
        for filename, count in remaining_files:
            print(f"   - {filename}: {count} occurrence(s)")
        print("\n   These require manual review.")
    else:
        print("   ✅ All process.exit() calls fixed!")


if __name__ == "__main__":
    main()
