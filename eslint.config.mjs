import antfu from "@antfu/eslint-config";

export default antfu(
  {
    stylistic: true,
    typescript: true,
    ignores: [
      "**/node_modules/**",
      "**/.output/**",
      "**/.agents/**",
      "**/.claude/**",
      "**/dist/**",
      "pnpm-lock.yaml",
    ],
  },
  {
    rules: {
      "ts/no-explicit-any": "off",
      "ts/prefer-literal-enum-member": "off",
      "ts/no-dynamic-delete": "off",
      "ts/no-use-before-define": "off",
      "comma-dangle": ["error", "always-multiline"],
      "no-alert": "off",
      "no-console": "off",
      "node/prefer-global/buffer": "off",
      "node/prefer-global/process": "off",
      "style/semi": ["error", "always"],
      "style/quotes": ["error", "double"],
      "style/brace-style": "off",
      "vue/no-multiple-template-root": "off",
      "vue/attribute-hyphenation": "off",
      "test/no-identical-title": "off",
    },
  },
);
