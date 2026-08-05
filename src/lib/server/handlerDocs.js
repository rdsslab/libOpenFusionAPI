import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { expandDocIncludes } from "./docsInclude.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const HANDLER_DOCS_ROOT = path.resolve(__dirname, "../../docs/handlers");
export const HANDLER_DOC_REQUIRED_FILES = ["README.md", "manifest.json", "AI_SKILL.md"];
export const HANDLER_DOC_OPTIONAL_FILES = ["examples.md", "examples.json", "api.generated.md"];

export const readHandlerSkill = async (handler) => {
  const dir = getHandlerDocDir(handler);
  const skillPath = path.resolve(dir, "AI_SKILL.md");
  const markdown = await expandDocIncludes(await readFileIfExists(skillPath));
  return {
    handler,
    markdown: markdown || "No specific AI skill documentation found for this handler."
  };
};

export const readFileIfExists = async (filePath) => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};

export const readJsonIfExists = async (filePath) => {
  const content = await readFileIfExists(filePath);
  if (content === undefined) return undefined;
  return JSON.parse(content);
};

export const getHandlerDocDir = (handler) => {
  return path.resolve(HANDLER_DOCS_ROOT, handler);
};

export const readHandlerDocBundle = async (handler) => {
  const dir = getHandlerDocDir(handler);
  const readmePath = path.resolve(dir, "README.md");
  const manifestPath = path.resolve(dir, "manifest.json");

  const [markdown, manifest] = await Promise.all([
    readFileIfExists(readmePath),
    readJsonIfExists(manifestPath),
  ]);

  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const existingFiles = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  const generatedFiles = manifest?.docs?.generated
    ?? existingFiles.filter((file) => file.endsWith(".generated.md"));
  const exampleFiles = manifest?.docs?.examples
    ?? existingFiles.filter((file) => file === "examples.md" || file === "examples.json");

  const generated = await Promise.all(
    generatedFiles.map(async (file) => ({
      file,
      markdown: await readFileIfExists(path.resolve(dir, file)),
    }))
  );

  const examples = await Promise.all(
    exampleFiles.map(async (file) => ({
      file,
      content: await readFileIfExists(path.resolve(dir, file)),
    }))
  );

  return {
    dir,
    markdown,
    manifest,
    generated,
    examples,
    files: {
      main: markdown ? "README.md" : undefined,
      manifest: manifest ? "manifest.json" : undefined,
      generated: generated.map((item) => item.file),
      examples: examples.map((item) => item.file),
      existing: existingFiles,
    },
  };
};

export const getHandlerLibraryDoc = async (handler, library) => {
  const dir = getHandlerDocDir(handler);
  const librariesDir = path.resolve(dir, "libraries");

  // If library is not provided, read the directory and return available library names
  if (!library) {
    try {
      const entries = await fs.readdir(librariesDir, { withFileTypes: true });
      const libraries = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
        .map((entry) => path.basename(entry.name, ".md"))
        .sort();
      return {
        handler,
        libraries
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { handler, libraries: [] };
      }
      throw error;
    }
  }

  // Sanitize the library parameter to protect against Path Traversal
  const libraryClean = String(library).trim();
  if (!/^[a-zA-Z0-9$_-]+$/.test(libraryClean)) {
    throw new Error("Invalid library name format.");
  }

  const filePath = path.resolve(librariesDir, `${libraryClean}.md`);

  // Double check that the file remains inside the libraries folder
  const relativePath = path.relative(librariesDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Access denied (Invalid library path)");
  }

  try {
    const markdown = await fs.readFile(filePath, "utf8");
    return {
      handler,
      library: libraryClean,
      markdown
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Library '${libraryClean}' documentation not found for handler '${handler}'`);
    }
    throw error;
  }
};
