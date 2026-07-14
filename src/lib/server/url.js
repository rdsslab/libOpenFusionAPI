import uFetch from "@rdsslab/uFetch";

const { PORT } = process.env;

export const getInternalURL = (relative_path) => {
  console.warn("Decrepted getInternalURL!!!!!\n" + relative_path + "\n");
  return `http://localhost:${PORT}${relative_path}`;
};

export const isAbsoluteUrl = (url) => {
  if (typeof url !== "string" || !url.includes(":")) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol.length > 0;
  } catch (e) {
    return false;
  }
};

export const fetchOFAPI = (url) => {
  url = isAbsoluteUrl(url) ? url : getInternalURL(url);
  return new uFetch(url);
};
