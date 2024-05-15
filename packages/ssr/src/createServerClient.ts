import { createClient } from '@supabase/supabase-js';
import { mergeDeepRight } from 'ramda';
import {
	DEFAULT_COOKIE_OPTIONS,
	combineChunks,
	createChunks,
	deleteChunks,
	isBrowser
} from './utils';

import type {
	GenericSchema,
	SupabaseClientOptions
} from '@supabase/supabase-js/dist/module/lib/types';
import type { CookieOptionsWithName, CookieMethods } from './types';

export function createServerClient<
	Database = any,
	SchemaName extends string & keyof Database = 'public' extends keyof Database
		? 'public'
		: string & keyof Database,
	Schema extends GenericSchema = Database[SchemaName] extends GenericSchema
		? Database[SchemaName]
		: any
>(
	supabaseUrl: string,
	supabaseKey: string,
	options: SupabaseClientOptions<SchemaName> & {
		cookies: CookieMethods;
		cookieOptions?: CookieOptionsWithName;
	}
) {
	if (!supabaseUrl || !supabaseKey) {
		throw new Error(
			`Your project's URL and Key are required to create a Supabase client!\n\nCheck your Supabase project's API settings to find these values\n\nhttps://supabase.com/dashboard/project/_/settings/api`
		);
	}

	const { cookies, cookieOptions, ...userDefinedClientOptions } = options;

	// use the cookie name as the storageKey value if it's set
	if (cookieOptions?.name) {
		userDefinedClientOptions.auth = {
			...userDefinedClientOptions.auth,
			storageKey: cookieOptions.name
		};
	}

	let storage: any;

	if ('get' in cookies) {
		const deleteAllChunks = async (key: string) => {
			await deleteChunks(
				key,
				async (chunkName) => {
					if (typeof cookies.get === 'function') {
						return await cookies.get(chunkName);
					}
				},
				async (chunkName) => {
					if (typeof cookies.remove === 'function') {
						return await cookies.remove(chunkName, {
							...DEFAULT_COOKIE_OPTIONS,
							...cookieOptions,
							maxAge: 0
						});
					}
				}
			);
		};

		storage = {
			// to signal to the libraries that these cookies are coming from a server environment and their value should not be trusted
			isServer: true,
			getItem: async (key: string) => {
				const chunkedCookie = await combineChunks(key, async (chunkName: string) => {
					if (typeof cookies.get === 'function') {
						return await cookies.get(chunkName);
					}
				});
				return chunkedCookie;
			},
			setItem: async (key: string, value: string) => {
				if (typeof cookies.set === 'function') {
					// first delete all chunks so that there would be no overlap
					await deleteAllChunks(key);

					const chunks = createChunks(key, value);

					for (let i = 0; i < chunks.length; i += 1) {
						const chunk = chunks[i];

						await cookies.set(chunk.name, chunk.value, {
							...DEFAULT_COOKIE_OPTIONS,
							...cookieOptions,
							maxAge: DEFAULT_COOKIE_OPTIONS.maxAge
						});
					}
				}
			},
			removeItem: async (key: string) => {
				if (typeof cookies.remove === 'function' && typeof cookies.get !== 'function') {
					console.log(
						'Removing chunked cookie without a `get` method is not supported.\n\n\tWhen you call the `createServerClient` function from the `@supabase/ssr` package, make sure you declare both a `get` and `remove` method on the `cookies` object.\n\nhttps://supabase.com/docs/guides/auth/server-side/creating-a-client'
					);
					return;
				}

				await deleteAllChunks(key);
			}
		};
	}

	const setItems: { [key: string]: string } = {};
	const removedItems: { [key: string]: boolean } = {};
	if ('getAll' in cookies) {
		storage = {
			// to signal to the libraries that these cookies are coming from a server environment and their value should not be trusted
			isServer: true,
			getItem: async (key: string) => {
				if (typeof setItems[key] === 'string') {
					return setItems[key];
				}

				if (removedItems[key]) {
					return null;
				}

				const allCookies = await cookies.getAll();
				const chunkedCookie = await combineChunks(key, async (chunkName: string) => {
					const cookie = allCookies?.find(({ name }) => name === chunkName) || null;

					if (!cookie) {
						return null;
					}

					return cookie.value;
				});

				return chunkedCookie;
			},
			setItem: async (key: string, value: string) => {
				setItems[key] = value;
				delete removedItems[key];
			},
			removeItem: async (key: string) => {
				delete setItems[key];
				removedItems[key] = true;
			}
		};
	}

	const cookieClientOptions = {
		global: {
			headers: {
				'X-Client-Info': `${PACKAGE_NAME}/${PACKAGE_VERSION}`
			}
		},
		auth: {
			flowType: 'pkce',
			autoRefreshToken: isBrowser(),
			detectSessionInUrl: isBrowser(),
			persistSession: true,
			storage
		}
	};

	// Overwrites default client config with any user defined options
	const clientOptions = mergeDeepRight(
		cookieClientOptions,
		userDefinedClientOptions
	) as SupabaseClientOptions<SchemaName>;

	const client = createClient<Database, SchemaName, Schema>(
		supabaseUrl,
		supabaseKey,
		clientOptions
	);

	if ('getAll' in cookies) {
		client.auth.onAuthStateChange(async (event) => {
			if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'SIGNED_OUT') {
				if (typeof cookies.setAll !== 'function') {
					console.log('You are holding it wrong!!!!!');
				}

				const allCookies = await cookies.getAll();
				const cookieNames = allCookies?.map(({ name }) => name) || [];

				const removeCookies = cookieNames.filter((name) => {
					if (removedItems[name]) {
						return true;
					}

					const chunkLike = name.match(/^(.*)[.](0|[1-9][0-9]*)$/);
					if (chunkLike && removedItems[chunkLike[1]]) {
						return true;
					}

					return false;
				});

				const setCookies = Object.keys(setItems).flatMap((itemName) => {
					const removeExistingCookiesForItem = new Set(
						cookieNames.filter((name) => {
							if (name === itemName) {
								return true;
							}

							const chunkLike = name.match(/^(.*)[.](0|[1-9][0-9]*)$/);
							if (chunkLike && chunkLike[1] === itemName) {
								return true;
							}

							return false;
						})
					);

					const chunks = createChunks(itemName, setItems[itemName]);

					chunks.forEach((chunk) => {
						removeExistingCookiesForItem.delete(chunk.name);
					});

					removeCookies.push(...removeExistingCookiesForItem);

					return chunks;
				});

				const removeCookieOptions = {
					...DEFAULT_COOKIE_OPTIONS,
					...cookieOptions,
					maxAge: 0
				};
				const setCookieOptions = {
					...DEFAULT_COOKIE_OPTIONS,
					...cookieOptions,
					maxAge: DEFAULT_COOKIE_OPTIONS.maxAge
				};

				await cookies.setAll(
					[].concat(
						removeCookies.map((name) => ({ name, value: '', options: removeCookieOptions })),
						setCookies.map(({ name, value }) => ({ name, value, options: setCookieOptions }))
					)
				);
			}
		});
	}

	return client;
}
