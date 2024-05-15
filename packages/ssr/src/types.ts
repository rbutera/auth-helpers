import type { CookieSerializeOptions } from 'cookie';

export type CookieOptions = Partial<CookieSerializeOptions>;
export type CookieOptionsWithName = { name?: string } & CookieOptions;
export type CookieMethods =
	| {
			/** @deprecated Move to using `getAll` instead. */
			get: (key: string) => Promise<string | null | undefined> | string | null | undefined;
			/** @deprecated Move to using `setAll` instead. */
			set?: (key: string, value: string, options: CookieOptions) => Promise<void> | void;
			/** @deprecated Move to using `setAll` instead. */
			remove?: (key: string, options: CookieOptions) => Promise<void> | void;
	  }
	| {
			getAll: () =>
				| Promise<{ name: string; value: string }[] | null>
				| { name: string; value: string }[]
				| null;
			setAll?: (
				cookies: { key: string; value: string; options: CookieOptions }[]
			) => Promise<void> | void;
	  };
