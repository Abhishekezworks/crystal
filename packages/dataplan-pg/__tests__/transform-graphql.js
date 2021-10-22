// IMPORTANT: after editing this file, you must run `yarn jest --clearCache`
// because the transformed code gets cached.
const JSON5 = require("json5");

exports.process = (src, path) => {
  const lines = src.split("\n");
  const config = Object.create(null);
  config.checkErrorShapshots = true;
  const assertions = [];
  const documentLines = [];
  const scripts = [];
  for (const line of lines) {
    if (line.startsWith("#>")) {
      const colon = line.indexOf(":");
      if (colon < 0) {
        throw new Error(
          `Invalid query configuration '${line}' - expected colon.`,
        );
      }
      const key = line.substr(2, colon - 2).trim();
      const value = JSON5.parse(line.substr(colon + 1));
      config[key] = value;
    } else if (line.startsWith("##")) {
      const assertion = line.substr(2);
      assertions.push(assertion);
      if (/expect\(errors\).toBeFalsy\(\)/.test(assertion)) {
        config.checkErrorShapshots = false;
      }
    } else if (line.startsWith("#!")) {
      scripts.push(line.substr(2));
    } else if (line.match(/^#\s*expect\(/)) {
      throw new Error(
        "Found line that looks like an assertion, but isn't in a '##' comment: '${line}'",
      );
    } else {
      documentLines.push(line);
    }
  }
  const document = documentLines.join("\n");

  // NOTE: technically JSON.stringify is not safe for producing JavaScript
  // code, this could be a security vulnerability in general. However, in this
  // case all the data that we're converting to code is controlled by us, so
  // we'd only be attacking ourselves, therefore we'll allow it rather than
  // bringing in an extra dependency.
  return `\
const { assertSnapshotsMatch, assertResultsMatch, assertErrorsMatch, runTestQuery } = require("../_test");

const document = ${JSON.stringify(document)};
const path = ${JSON.stringify(path)};
const config = ${JSON.stringify(config)};

let result1;
let result2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (conditionCallback, max = 1000) => {
  let start = Date.now();
  while (!conditionCallback()) {
    if (Date.now() >= start + max) {
      throw new Error(\`Waited \${max}ms but condition does not pass\`);
    }
    await sleep(10);
  }
}

const callback = ${
    scripts.length
      ? `async (pgClient, payloads) => {
  ${scripts.join("\n  ")}
}`
      : `null`
  };

beforeAll(() => {
  result1 =
    runTestQuery(document, config, { callback });
  // Always run result2 after result1 finishes
  result2 = result1.then(() => {}, () => {}).then(() =>
    runTestQuery(document, config, { callback, deoptimize: true })
  );
  // Wait for these promises to resolve, even if it's with errors.
  return Promise.all([result1.catch(e => {}), result2.catch(e => {})]);
});

${assertions
  .map((assertion) => {
    return `\
it(${JSON.stringify(assertion.trim())}, async () => {
  const { data, payloads, errors, queries } = await result1;
  ${assertion}
});`;
  })
  .join("\n\n")}

it('matches SQL snapshots', () => assertSnapshotsMatch('sql', {
  document,
  path,
  config,
  result: result1,
}));

it('matches data snapshot', () => assertSnapshotsMatch('result', {
  document,
  path,
  config,
  result: result1,
}));

if (config.checkErrorShapshots) {
  it('matches errors snapshot', () => assertSnapshotsMatch('errors', {
    document,
    path,
    config,
    result: result1,
  }));
}

it('returns same data for optimized vs deoptimized', () => assertResultsMatch(result1, result2));
it('returns same errors for optimized vs deoptimized', () => assertErrorsMatch(result1, result2));

it('matches SQL snapshots with inlining disabled', () => assertSnapshotsMatch('sql', {
  document,
  path,
  config,
  result: result2,
  ext: ".deopt",
}));
`;
};
