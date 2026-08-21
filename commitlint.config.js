/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['backend', 'frontend', 'shared', 'infra', 'ci', 'docs', 'deps', 'release'],
    ],
    'scope-empty': [0],
    'body-max-line-length': [0],
  },
};
