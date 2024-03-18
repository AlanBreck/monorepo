import { createLink } from "./Link"
import { getLanguage } from "./getLanguage.client"
import { availableLanguageTags, sourceLanguageTag } from "$paraglide/runtime.js"
import { PrefixStrategy } from "./routing/prefixStrategy"
import { createNavigation, createRedirects } from "./navigation"
import { createExclude } from "./exclude"
import { createMiddleware } from "./middleware"
import type { I18nUserConfig, ResolvedI18nConfig } from "./config"
import { resolvePathTranslations } from "./pathnames/resolvePathTranslations"

export function createI18n<T extends string = string>(userConfig: I18nUserConfig<T> = {}) {
	const config: ResolvedI18nConfig<T> = {
		availableLanguageTags: availableLanguageTags as readonly T[],
		defaultLanguage: userConfig.defaultLanguage ?? (sourceLanguageTag as T),
		exclude: createExclude(userConfig.exclude ?? []),
		pathnames: resolvePathTranslations(userConfig.pathnames ?? {}, availableLanguageTags as T[]),
	}

	const strategy = PrefixStrategy<T>({
		availableLanguageTags: config.availableLanguageTags,
		pathnames: config.pathnames,
		defaultLanguage: config.defaultLanguage,
		exclude: config.exclude,
	})

	/**
	 * React Component that enables cslient-side transitions between routes.
	 *
	 * Automatically localises the href based on the current language.
	 */
	const Link = createLink<T>(getLanguage, config, strategy)
	const { usePathname, useRouter } = createNavigation<T>(getLanguage, strategy)
	const { redirect, permanentRedirect } = createRedirects<T>(getLanguage, strategy)
	const middleware = createMiddleware<T>(config, strategy)

	return {
		Link,
		usePathname,
		localizePath: strategy.getLocalisedPath,
		middleware,
		useRouter,
		redirect,
		permanentRedirect,
	}
}
