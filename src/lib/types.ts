// Types shared by server and client. Keep this module free of server imports.

export type UserRole = 'admin' | 'user';

export interface AdminUser {
	id: string;
	name: string;
	email: string;
	image: string | null;
	role: UserRole;
	createdAt: number;
	lastActiveAt: number | null;
	/** better-auth provider ids: 'credential' (password), 'oidc'. */
	signInMethods: string[];
	hasPassword: boolean;
}

export const API_SCOPES = ['status:read', 'monitors:write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiKey {
	id: string;
	label: string;
	scopes: ApiScope[];
	/** The MCP client the key was approved for through OAuth; null for keys made by hand. */
	oauthClient: string | null;
	createdAt: number;
	lastUsedAt: number | null;
}

export const MONITOR_TYPES = ['http', 'docker'] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** 'pending': failing with retries left, or a container still starting. */
export type MonitorStatus = 'up' | 'down' | 'pending' | 'unknown' | 'paused';

export interface Monitor {
	id: string;
	name: string;
	description: string | null;
	type: MonitorType;
	url: string | null;
	method: HttpMethod;
	/** Comma separated codes and ranges, e.g. "200-299,301". */
	acceptedStatuses: string;
	/** Text the response body must contain. */
	keyword: string | null;
	ignoreTls: boolean;
	/** Container name or id. */
	container: string | null;
	/** Docker Engine API for this monitor; null uses DOCKER_HOST. */
	dockerHost: string | null;
	intervalSeconds: number;
	timeoutSeconds: number;
	/** Failed checks in a row before the monitor counts as down. */
	retries: number;
	enabled: boolean;
	/** Shown on the public status page. */
	public: boolean;
	sortOrder: number;
	status: MonitorStatus;
	message: string | null;
	latencyMs: number | null;
	lastCheckedAt: number | null;
	lastChangeAt: number | null;
	createdAt: number;
	updatedAt: number;
	/** The site's icon (same origin, versioned); null for Docker monitors or when none was found. */
	faviconUrl: string | null;
	/** Declared in the monitors file (MONITORS_FILE); edits to the fields it sets are undone when the file is applied. */
	managedByConfig: boolean;
}

export interface Heartbeat {
	status: Exclude<MonitorStatus, 'unknown' | 'paused'>;
	latencyMs: number | null;
	message: string | null;
	checkedAt: number;
}

/** Share of up checks (0–100) over a window; null without checks. */
export interface Uptime {
	day: number | null;
	week: number | null;
	month: number | null;
}

/** A monitor as lists show it: the latest checks for its bar, and its uptime. */
export interface MonitorSummary extends Monitor {
	recent: Heartbeat[];
	uptime: Uptime;
}

/** What the public status page shows of a monitor: no targets, hosts or messages. */
export interface PublicMonitor {
	id: string;
	name: string;
	description: string | null;
	type: MonitorType;
	status: MonitorStatus;
	latencyMs: number | null;
	lastCheckedAt: number | null;
	/** As on Monitor: served without sign-in for public monitors. */
	faviconUrl: string | null;
	uptime: Uptime;
	/** Daily buckets, oldest first. */
	days: { date: string; uptime: number | null; down: number }[];
}

/** A monitor's live state, as a check leaves it. */
export type MonitorLiveState = Pick<
	Monitor,
	'status' | 'message' | 'latencyMs' | 'lastCheckedAt' | 'lastChangeAt'
>;

/** Events the dashboard's stream (/api/events) sends. */
export type ServerEvent =
	| { type: 'monitor.checked'; monitorId: string; heartbeat: Heartbeat; state: MonitorLiveState }
	/** Created, edited, paused or resumed: reload to pick up the new config. */
	| { type: 'monitor.changed'; monitorId: string }
	| { type: 'monitor.deleted'; monitorId: string };

/** Events the public status page's stream (/api/public/events) sends: public monitors only, no messages. */
export type PublicEvent =
	| {
			type: 'monitor.checked';
			monitorId: string;
			status: MonitorStatus;
			latencyMs: number | null;
			lastCheckedAt: number | null;
	  }
	| { type: 'monitors.changed' };

export interface StatusPageSettings {
	title: string;
	description: string;
}

/** Kinds of notification channel. Each has a driver in src/lib/server/notifications/. */
export const NOTIFICATION_TYPES = ['gotify'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A Gotify channel's settings as the browser sees them: the app token never leaves the server. */
export interface GotifyPublicConfig {
	/** Server URL, e.g. https://push.example.com */
	url: string;
	/** 0–10; Gotify clients alert loudly from about 8. */
	priority: number;
	hasToken: boolean;
}

/** Per channel type, what the browser sees of its config. */
export interface NotificationPublicConfigs {
	gotify: GotifyPublicConfig;
}

/** Where Statty sends a message when a monitor goes down or comes back up. */
export type NotificationChannel = {
	[T in NotificationType]: {
		id: string;
		name: string;
		type: T;
		config: NotificationPublicConfigs[T];
		enabled: boolean;
		/** Every monitor, including ones added later; otherwise only `monitorIds`. */
		allMonitors: boolean;
		monitorIds: string[];
		createdAt: number;
		updatedAt: number;
	};
}[NotificationType];
