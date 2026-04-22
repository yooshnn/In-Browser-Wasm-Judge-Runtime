export type ExactCheckerSpec = {
  kind: 'exact';
  ignoreTrailingWhitespace: boolean;
};

export type CustomCheckerSpec = {
  kind: 'custom';
  checkerId: string;
};

export type CheckerSpec = ExactCheckerSpec | CustomCheckerSpec;
