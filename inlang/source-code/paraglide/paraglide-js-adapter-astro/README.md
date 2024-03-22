![Dead Simple i18n. Typesafe, Small Footprint, SEO-Friendly and with an IDE Integration.](https://cdn.jsdelivr.net/gh/opral/monorepo@latest/inlang/source-code/paraglide/paraglide-js-adapter-astro/assets/header.png)

<doc-features>
<doc-feature text-color="#0F172A" color="#E1EFF7" title="Uses astro:i18n for routing" image="https://cdn.jsdelivr.net/gh/opral/monorepo@latest/inlang/source-code/paraglide/paraglide-js-adapter-astro/assets/use-astro-i18n.png"></doc-feature>
<doc-feature text-color="#0F172A" color="#E1EFF7" title="Tiny Bundle Size" image="https://cdn.jsdelivr.net/gh/opral/monorepo@latest/inlang/source-code/paraglide/paraglide-js-adapter-astro/assets/bundle-size.png"></doc-feature>
<doc-feature text-color="#0F172A" color="#E1EFF7" title="Only ship what's on islands" image="https://cdn.jsdelivr.net/gh/opral/monorepo@latest/inlang/source-code/paraglide/paraglide-js-adapter-astro/assets/islands-only.png"></doc-feature>
</doc-features>

## Installation

```bash
npx @inlang/paraglide-js init
npm i @inlang/paraglide-js-adapter-astro
```

Register the Integration in `astro.config.mjs`:

```js
import paraglide from "@inlang/paraglide-js-adapter-astro"

export default {
	integrations: [
		paraglide({
      // recommended settings
			project: "./project.inlang",
			outdir: "./src/paraglide", //where your files should be
		}),
	],

	// you can, but don't have to, use astro's i18n routing
  // Everything including paths just works
	i18n: {
		locales: [
			"en",
			{ code: "de", path: "deutsch" },
		],
		defaultLocale: "en",
	},
}
```

## Usage

### Adding & using messages

Messages are placed in `messages/{lang}.json`.

```json
// messages.en.json
{
	"hello": "Hello {name}!"
}
```

Declare which languages you support in `project.inlang/settings.json`.

```json
{
	"languageTags": ["en", "de"],
	"sourceLanguageTag": "en"
}
```

Use messages like so:

```astro
---
import * as m from "../paraglide/messages.js";
---

<h1>{m.hello({ name: "Samuel" })}</h1>
```

Vite is able to tree-shake the messages. Only messages that are used on an Island will be included in the client bundle. This drastically reduces the bundle size & requires no extra work from you.

### Which language get's used

The integration detects the language from the URL. Simply place your page in a folder named for the language (or the `path` of the language) & all messages will be in that language.

```filesystem
src
├── pages
│   ├── en
│   │   ├── index.astro
│   │   └── about.astro
│   └── de
│       ├── index.astro
│       └── about.astro
```

If a page isn't in a language folder, it will use the default language.

```filesystem
src
├── pages
│   ├── index.astro // default language
│   ├── about.astro // default language
│   └── de
│       ├── index.astro // de
│       └── about.astro // de
```

You can configure which languages are available, and which is the default language in `project.inlang/settings.json`.

To save bundle size the integration doesn't ship language detection code to the client. Instead, it will read the `lang` attribute on the `<html>` tag. Make sure it is set correctly.

```astro
//src/layouts/default.astro
---
import { languageTag } from "$paraglide/runtime";
---

<!doctype html>
<html lang={languageTag()}>
    <slot />
</html>
---
```

You can also access the current language and text-direction via `Astro.locals.paraglide.lang` and `Astro.locals.paraglide.dir` respectively.

### Adding Alternate Links

For SEO reasons, you should add alternate links to your page's head that point to all translations of the current page. Also include the _current_ page.

```html
<head>
	<link rel="alternate" hreflang="en" href="/en/about" />
	<link rel="alternate" hreflang="de" href="/de/ueber-uns" />
</head>
```

Since only you know which pages correspond to each other this needs to be done manually.

## Roadmap

- Improved Server-Rendering support

## Playground

Check out an example Astro project with Paraglide integration on [StackBlitz](https://stackblitz.com/~/github.com/LorisSigrist/paraglide-astro-example)
