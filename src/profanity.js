/**
 * Word blacklist used to filter meme-coin events that surface in the
 * Pump.fun feed widget. Tokens whose name / symbol / description contain
 * any substring listed here are dropped before rendering.
 *
 * Lower-case substring match. Includes common slurs and severe profanity
 * we never want to render in a public feed embedded on third-party sites.
 */

export const WORD_BLACKLIST = [
	'nigger',
	'nigga',
	'niglet',
	'niggers',
	'niggas',
	'faggot',
	'fagot',
	'faggots',
	'tranny',
	'trannies',
	'retard',
	'retarded',
	'kike',
	'kikes',
	'chink',
	'chinks',
	'spic',
	'spics',
	'gook',
	'gooks',
	'wetback',
	'wetbacks',
	'beaner',
	'beaners',
	'coon',
	'coons',
	'cunt',
	'cunts',
	'pedophile',
	'pedo',
	'pedos',
	'cp ',
	' cp',
	'childporn',
	'child porn',
	'rape',
	'rapist',
	'rapists',
	'kys',
	'killyourself',
	'kill yourself',
	'jewrat',
	'whitepower',
	'white power',
	'heilhitler',
	'heil hitler',
	'sieg heil',
	'1488',
];
