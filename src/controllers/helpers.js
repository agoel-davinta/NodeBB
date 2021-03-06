'use strict';

const nconf = require('nconf');
const validator = require('validator');
const querystring = require('querystring');
const _ = require('lodash');

const user = require('../user');
const privileges = require('../privileges');
const categories = require('../categories');
const plugins = require('../plugins');
const meta = require('../meta');
const middleware = require('../middleware');

const helpers = module.exports;

helpers.noScriptErrors = async function (req, res, error, httpStatus) {
	if (req.body.noscript !== 'true') {
		return res.status(httpStatus).send(error);
	}

	const httpStatusString = httpStatus.toString();
	await middleware.buildHeaderAsync(req, res);
	res.status(httpStatus).render(httpStatusString, {
		path: req.path,
		loggedIn: req.loggedIn,
		error: error,
		returnLink: true,
		title: '[[global:' + httpStatusString + '.title]]',
	});
};

helpers.validFilters = { '': true, new: true, watched: true, unreplied: true };

helpers.terms = {
	daily: 'day',
	weekly: 'week',
	monthly: 'month',
};

helpers.buildQueryString = function (cid, filter, term) {
	const qs = {};
	if (cid) {
		qs.cid = cid;
	}
	if (filter) {
		qs.filter = filter;
	}
	if (term) {
		qs.term = term;
	}

	return Object.keys(qs).length ? '?' + querystring.stringify(qs) : '';
};

helpers.buildFilters = function (url, filter, query) {
	return [{
		name: '[[unread:all-topics]]',
		url: url + helpers.buildQueryString(query.cid, '', query.term),
		selected: filter === '',
		filter: '',
	}, {
		name: '[[unread:new-topics]]',
		url: url + helpers.buildQueryString(query.cid, 'new', query.term),
		selected: filter === 'new',
		filter: 'new',
	}, {
		name: '[[unread:watched-topics]]',
		url: url + helpers.buildQueryString(query.cid, 'watched', query.term),
		selected: filter === 'watched',
		filter: 'watched',
	}, {
		name: '[[unread:unreplied-topics]]',
		url: url + helpers.buildQueryString(query.cid, 'unreplied', query.term),
		selected: filter === 'unreplied',
		filter: 'unreplied',
	}];
};

helpers.buildTerms = function (url, term, query) {
	return [{
		name: '[[recent:alltime]]',
		url: url + helpers.buildQueryString(query.cid, query.filter, ''),
		selected: term === 'alltime',
		term: 'alltime',
	}, {
		name: '[[recent:day]]',
		url: url + helpers.buildQueryString(query.cid, query.filter, 'daily'),
		selected: term === 'day',
		term: 'day',
	}, {
		name: '[[recent:week]]',
		url: url + helpers.buildQueryString(query.cid, query.filter, 'weekly'),
		selected: term === 'week',
		term: 'week',
	}, {
		name: '[[recent:month]]',
		url: url + helpers.buildQueryString(query.cid, query.filter, 'monthly'),
		selected: term === 'month',
		term: 'month',
	}];
};

helpers.notAllowed = async function (req, res, error) {
	const data = await plugins.fireHook('filter:helpers.notAllowed', {
		req: req,
		res: res,
		error: error,
	});

	if (req.loggedIn || req.uid === -1) {
		if (res.locals.isAPI) {
			res.status(403).json({
				path: req.path.replace(/^\/api/, ''),
				loggedIn: req.loggedIn,
				error: data.error,
				title: '[[global:403.title]]',
			});
		} else {
			await middleware.buildHeaderAsync(req, res);
			res.status(403).render('403', {
				path: req.path,
				loggedIn: req.loggedIn,
				error: data.error,
				title: '[[global:403.title]]',
			});
		}
	} else if (res.locals.isAPI) {
		req.session.returnTo = req.url.replace(/^\/api/, '');
		res.status(401).json('not-authorized');
	} else {
		req.session.returnTo = req.url;
		res.redirect(nconf.get('relative_path') + '/login');
	}
};

helpers.redirect = function (res, url) {
	if (res.locals.isAPI) {
		res.set('X-Redirect', encodeURI(url)).status(200).json(url);
	} else {
		res.redirect(nconf.get('relative_path') + encodeURI(url));
	}
};

helpers.buildCategoryBreadcrumbs = async function (cid) {
	const breadcrumbs = [];

	while (parseInt(cid, 10)) {
		/* eslint-disable no-await-in-loop */
		const data = await categories.getCategoryFields(cid, ['name', 'slug', 'parentCid', 'disabled', 'isSection']);
		if (!data.disabled && !data.isSection) {
			breadcrumbs.unshift({
				text: String(data.name),
				url: nconf.get('relative_path') + '/category/' + data.slug,
				cid: cid,
			});
		}
		cid = data.parentCid;
	}
	if (meta.config.homePageRoute && meta.config.homePageRoute !== 'categories') {
		breadcrumbs.unshift({
			text: '[[global:header.categories]]',
			url: nconf.get('relative_path') + '/categories',
		});
	}

	breadcrumbs.unshift({
		text: '[[global:home]]',
		url: nconf.get('relative_path') + '/',
	});

	return breadcrumbs;
};

helpers.buildBreadcrumbs = function (crumbs) {
	const breadcrumbs = [
		{
			text: '[[global:home]]',
			url: nconf.get('relative_path') + '/',
		},
	];

	crumbs.forEach(function (crumb) {
		if (crumb) {
			if (crumb.url) {
				crumb.url = nconf.get('relative_path') + crumb.url;
			}
			breadcrumbs.push(crumb);
		}
	});

	return breadcrumbs;
};

helpers.buildTitle = function (pageTitle) {
	const titleLayout = meta.config.titleLayout || '{pageTitle} | {browserTitle}';

	const browserTitle = validator.escape(String(meta.config.browserTitle || meta.config.title || 'NodeBB'));
	pageTitle = pageTitle || '';
	const title = titleLayout.replace('{pageTitle}', () => pageTitle).replace('{browserTitle}', () => browserTitle);
	return title;
};

helpers.getCategories = async function (set, uid, privilege, selectedCid) {
	const cids = await categories.getCidsByPrivilege(set, uid, privilege);
	return await getCategoryData(cids, uid, selectedCid);
};

helpers.getCategoriesByStates = async function (uid, selectedCid, states) {
	const cids = await categories.getAllCidsFromSet('categories:cid');
	return await getCategoryData(cids, uid, selectedCid, states);
};

async function getCategoryData(cids, uid, selectedCid, states) {
	if (selectedCid && !Array.isArray(selectedCid)) {
		selectedCid = [selectedCid];
	}
	selectedCid = selectedCid && selectedCid.map(String);
	states = states || [categories.watchStates.watching, categories.watchStates.notwatching];

	const [allowed, watchState, categoryData, isAdmin] = await Promise.all([
		privileges.categories.isUserAllowedTo('topics:read', cids, uid),
		categories.getWatchState(cids, uid),
		categories.getCategoriesData(cids),
		user.isAdministrator(uid),
	]);

	categories.getTree(categoryData);

	const cidToAllowed = _.zipObject(cids, allowed.map(allowed => isAdmin || allowed));
	const cidToCategory = _.zipObject(cids, categoryData);
	const cidToWatchState = _.zipObject(cids, watchState);

	const visibleCategories = categoryData.filter(function (c) {
		const hasVisibleChildren = checkVisibleChildren(c, cidToAllowed, cidToWatchState, states);
		const isCategoryVisible = c && cidToAllowed[c.cid] && !c.link && !c.disabled && states.includes(cidToWatchState[c.cid]);
		const shouldBeRemoved = !hasVisibleChildren && !isCategoryVisible;

		if (shouldBeRemoved && c && c.parent && c.parent.cid && cidToCategory[c.parent.cid]) {
			cidToCategory[c.parent.cid].children = cidToCategory[c.parent.cid].children.filter(child => child.cid !== c.cid);
		}

		return c && !shouldBeRemoved;
	});

	const categoriesData = categories.buildForSelectCategories(visibleCategories);

	let selectedCategory = [];
	const selectedCids = [];
	categoriesData.forEach(function (category) {
		category.selected = selectedCid ? selectedCid.includes(String(category.cid)) : false;
		if (category.selected) {
			selectedCategory.push(category);
			selectedCids.push(category.cid);
		}
	});
	selectedCids.sort((a, b) => a - b);

	if (selectedCategory.length > 1) {
		selectedCategory = {
			icon: 'fa-plus',
			name: '[[unread:multiple-categories-selected]]',
			bgColor: '#ddd',
		};
	} else if (selectedCategory.length === 1) {
		selectedCategory = selectedCategory[0];
	} else {
		selectedCategory = undefined;
	}

	return {
		categories: categoriesData,
		selectedCategory: selectedCategory,
		selectedCids: selectedCids,
	};
}

function checkVisibleChildren(c, cidToAllowed, cidToWatchState, states) {
	if (!c || !Array.isArray(c.children)) {
		return false;
	}
	return c.children.some(c => c && !c.disabled && (
		(cidToAllowed[c.cid] && states.includes(cidToWatchState[c.cid])) || checkVisibleChildren(c, cidToAllowed, cidToWatchState, states)
	));
}

helpers.getHomePageRoutes = async function (uid) {
	let cids = await categories.getAllCidsFromSet('categories:cid');
	cids = await privileges.categories.filterCids('find', cids, uid);
	const categoryData = await categories.getCategoriesFields(cids, ['name', 'slug']);

	const categoryRoutes = categoryData.map(function (category) {
		return {
			route: 'category/' + category.slug,
			name: 'Category: ' + category.name,
		};
	});
	const routes = [
		{
			route: 'categories',
			name: 'Categories',
		},
		{
			route: 'unread',
			name: 'Unread',
		},
		{
			route: 'recent',
			name: 'Recent',
		},
		{
			route: 'top',
			name: 'Top',
		},
		{
			route: 'popular',
			name: 'Popular',
		},
	].concat(categoryRoutes, [
		{
			route: 'custom',
			name: 'Custom',
		},
	]);
	const data = await plugins.fireHook('filter:homepage.get', { routes: routes });
	return data.routes;
};

require('../promisify')(helpers);
