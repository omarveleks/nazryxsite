# Interface languages

English, French and Russian. The English text is the key: `t('Save')`, `t('{n} of {total}', { n, total })`. A key without a
translation falls back to English, so a new string never breaks a page.

- Pages: `const t = setLang(langOf(u));` right after `requireUser`. Shared server components: `const t = tt();`.
  Client components take `lang` as a prop and call `tr(lang)`.
- Data labels (therapeutic classes, dosage forms, stages, plan names, country names) go through the same dictionaries:
  `t(countryName(c))`, `t(category)`.
- The language is the account's setting (Settings, or `/lang/fr?next=/m`); signed out it is the `nzx_lang` cookie.
  A language picked while signed out becomes the account's language at sign-in when the account still has the default.
- Add translations in `fr.ts` and `ru.ts`. Keys must be unique in each file (the build fails on a duplicate).
- Not yet translated: the help FAQ, the guided tour, and parts of the product detail page.
