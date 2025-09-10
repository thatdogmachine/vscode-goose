import { EventEmitter } from "events";
import { Message } from "../types/messages";
import { logger as singletonLogger, Logger } from "../utils/logger"; // Import singleton logger
import { GooseConfig } from "../utils/configReader"; // Import GooseConfig from correct file
import * as vscode from 'vscode'; // Needed for getConfiguration

// Define interfaces for complex parameter objects
interface StreamChatParams {
    prompt: Message[]; // Expect an array of messages
    abortController?: AbortController; // Make optional if sometimes omitted
    sessionId?: string; // Make optional
    workspaceDirectory?: string; // Make optional
    // Add any other relevant parameters needed by the API
}

/**
 * Configuration for the ApiClient
 */
export interface ApiClientConfig {
    baseUrl: string;
    secretKey: string;
    logger: Logger; // Use our specific Logger type
    events?: EventEmitter;
    debug?: boolean;
}

/**
 * A platform-agnostic client for communicating with the Goose API server
 */
export class ApiClient {
    private baseUrl: string;
    private secretKey: string;
    private logger: Logger; // Store the specific Logger instance
    private events: EventEmitter;
    private secretProviderKeys: string[] = []; // Store names of secret keys
    private debug: boolean; // Declare the debug property

    constructor(config: ApiClientConfig) {
        this.baseUrl = config.baseUrl;
        this.secretKey = config.secretKey;
        this.events = config.events || new EventEmitter();
        this.logger = config.logger.createSource('ApiClient'); // Create a source-tagged logger
        this.debug = config.debug ?? false;
    }

    /**
     * Sets the list of provider configuration keys that are considered secret.
     * @param keys An array of secret key names.
     */
    public setSecretProviderKeys(keys: string[]): void {
        this.secretProviderKeys = keys;
        this.logger.debug(`Received ${keys.length} secret provider keys to redact.`);
    }

    /**
     * Sets the list of secret keys specific to the current provider for redaction.
     * @param keys An array of secret key names.
     */
    public setSecretProviderKeysForCurrentProvider(keys: string[]): void {
        // TODO: Implement logic to use these keys for redaction in the logger or request method.
        this.logger.warn(`ApiClient.setSecretProviderKeys received keys: [${keys.join(', ')}], but redaction logic is not fully implemented.`);
    }

    /**
     * Redacts sensitive information (X-Secret-Key, provider secrets) from headers or body.
     * @param data The data to redact (string or object).
     * @returns The redacted data.
     */
    private redactSecrets(data: any): any {
        const redactedPlaceholder = '***REDACTED***';
        let redactedData = JSON.parse(JSON.stringify(data)); // Deep clone to avoid modifying original

        // Redact X-Secret-Key in headers (if data is an object)
        if (typeof redactedData === 'object' && redactedData !== null && redactedData['X-Secret-Key']) {
            redactedData['X-Secret-Key'] = redactedPlaceholder;
        }

        // If data is a string, attempt simple string replacement
        // This is less robust than object property redaction
        if (typeof redactedData === 'string') {
            // Redact X-Secret-Key value if it appears in the string body
            // Assuming the header format might be logged directly in error scenarios
            const secretKeyPattern = new RegExp(`"?X-Secret-Key"?:\s*"?${this.secretKey}"?`, 'gi');
            redactedData = redactedData.replace(secretKeyPattern, '"X-Secret-Key":"' + redactedPlaceholder + '"');

            // Add generic redaction for common API key patterns in stringified data
            const commonKeyPatterns = [
                /"api_key"\s*:\s*"(.*?)"/gi,
                /"secret_key"\s*:\s*"(.*?)"/gi,
                /"token"\s*:\s*"(.*?)"/gi,
                /api_key=([^&\s]+)/gi,
                /secret_key=([^&\s]+)/gi,
                /token=([^&\s]+)/gi
            ];

            for (const pattern of commonKeyPatterns) {
                redactedData = redactedData.replace(pattern, (match: string, p1: string) => {
                    // Replace the value part (p1) with the placeholder
                    return match.replace(p1, redactedPlaceholder);
                });
            }
        }

        return redactedData;
    }

    /**
     * Make a request to the Goose API
     * @param path The API endpoint path
     * @param options Fetch options
     * @returns The fetch response
     */
    public async request(
        path: string,
        options: RequestInit = {},
    ): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            ...options.headers,
            "Content-Type": "application/json",
            "X-Secret-Key": this.secretKey,
        };

        // Read logging configuration
        const config = vscode.workspace.getConfiguration('goose.logging');
        const logSensitive = config.get<boolean>('logSensitiveRequests', false);
        // Logging happens only if logger is enabled and level is appropriate (handled by logger itself)
        // We only need the logSensitive flag here for conditional body logging.

        this.logger.debug(`API Request: ${options.method || 'GET'} ${path}`);

        // Log redacted headers at DEBUG level
        this.logger.debug('Request Headers:', this.redactSecrets(headers));

        // Log redacted body conditionally at DEBUG level
        if (options.body && logSensitive) {
            try {
                // Attempt to parse body if JSON, otherwise log as string
                let bodyToLog: any;
                if (typeof options.body === 'string') {
                    try {
                        bodyToLog = JSON.parse(options.body);
                    } catch (e) {
                        bodyToLog = options.body; // Log as string if not JSON
                    }
                } else {
                    bodyToLog = options.body;
                }
                this.logger.debug('Request Body:', this.redactSecrets(bodyToLog));
            } catch (e) {
                this.logger.warn('Could not process request body for logging:', e);
                this.logger.debug('Raw Request Body (unredacted, use with caution):', options.body);
            }
        } else if (options.body) {
            this.logger.debug('Request Body: [REDACTED BY CONFIG]');
        }

        try {
            const response = await fetch(url, { ...options, headers });

            this.logger.debug(`API Response Status: ${response.status} ${response.statusText} for ${options.method || 'GET'} ${path}`);

            // Log response headers at DEBUG level (generally safe)
            const responseHeaders: { [key: string]: string } = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });
            this.logger.debug('Response Headers:', responseHeaders);

            if (!response.ok) {
                let errorBody = "[Could not read error body]";
                try {
                    errorBody = await response.text();
                } catch (e) { /* Ignore */ }

                let errorBodyToShow = logSensitive ? this.redactSecrets(errorBody) : "[REDACTED BY CONFIG]";
                this.logger.error(`API Error ${response.status} ${response.statusText} for ${options.method || 'GET'} ${path}. Body:`, errorBodyToShow);

                throw new Error(
                    `API request failed: ${response.status} ${response.statusText} - ${errorBody}` // Include body
                );
            }

            // Log response body conditionally at DEBUG level
            if (logSensitive) {
                const clone = response.clone();
                try {
                    let bodyToLog: any;
                    const contentType = clone.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        bodyToLog = await clone.json();
                    } else {
                        bodyToLog = await clone.text();
                    }
                    this.logger.debug('Response Body:', this.redactSecrets(bodyToLog));
                } catch (e) {
                    this.logger.warn('Could not process response body for logging:', e);
                    // Avoid logging raw potentially sensitive body here
                }
            } else {
                // Only log body if sensitive logging is off *and* it's not a streaming type?
                // Or just always say redacted if sensitive logging is off?
                // Let's go with always redacted if sensitive logging is off.
                this.logger.debug('Response Body: [REDACTED BY CONFIG]');
            }

            return response;
        } catch (error) {
            // Log the error object itself which might contain more details
            // The error from response.ok check is already logged above.
            if (!(error instanceof Error && error.message.startsWith('API request failed'))) {
                this.logger.error(`API request to ${path} encountered an unexpected error:`, error);
            }
            throw error;
        }
    }

    // --- START: Implemented Session Methods ---

    public async listSessions(): Promise<any[]> {
        this.logger.info("Fetching sessions list...");
        const path = '/sessions';
        const options: RequestInit = { method: 'GET' };
        try {
            const response = await this.request(path, options);
            const rawData = await response.json();
            // this.logger.debug('Raw response from /sessions:', JSON.stringify(rawData)); // Reverted
            // Handle potential response structures (direct array or object with 'sessions' key)
            const sessions = Array.isArray(rawData) ? rawData : (rawData?.sessions || []);
            this.logger.info(`Sessions list fetched successfully. Processed count: ${sessions.length}`);
            // TODO: Consider adding data validation/transformation if needed
            return sessions;
        } catch (error) {
            this.logger.error('Failed to list sessions:', error);
            throw error; // Re-throw to allow caller to handle
        }
    }

    public async getSessionHistory(sessionId: string): Promise<any | null> {
        this.logger.info(`Fetching session history for ID: ${sessionId}`);
        const path = `/sessions/${sessionId}`; // Use path parameter
        const options: RequestInit = { method: 'GET' };
        try {
            const response = await this.request(path, options);
            const data = await response.json();
            this.logger.info(`Session history fetched successfully for ID: ${sessionId}`);
            // TODO: Consider adding data validation/transformation if needed
            return data;
        } catch (error) {
            this.logger.error(`Failed to get session history for ${sessionId}:`, error);
            // Decide whether to return null or throw based on expected caller behavior
            // Throwing might be better to signal a clear failure
            throw error;
        }
    }

    // --- END: Implemented Session Methods ---

    // --- START: Stub methods to fix TS2339 errors ---

    public async renameSession(sessionId: string, newName: string): Promise<boolean> {
        this.logger.warn(`ApiClient.renameSession(${sessionId}, ${newName}) is not implemented`);
        return false; // Placeholder
    }

    public async deleteSession(sessionId: string): Promise<boolean> {
        this.logger.warn(`ApiClient.deleteSession(${sessionId}) is not implemented`);
        return false; // Placeholder
    }

    public async getAgentVersions(): Promise<{ available_versions: string[], default_version: string }> {
        this.logger.info("Fetching agent versions...");
        const path = '/agent/versions';
        const options: RequestInit = { method: 'GET' };
        try {
            const response = await this.request(path, options);
            const responseData = await response.json();
            this.logger.info(`Agent versions fetched successfully. Default: ${responseData.default_version}`, responseData);
            return responseData;
        } catch (error) {
            this.logger.error('Failed to fetch agent versions:', error);
            throw error; // Re-throw to allow caller to handle
        }
    }

    public async updateAgentProvider(provider: string, model?: string, version?: string, sessionId?: string): Promise<any> {
        this.logger.info(`Updating agent provider/model with: provider=${provider}, model=${model || "default"}, version=${version || "default"}, session: ${sessionId || "new"}`);
        const path = '/agent/update_provider'; // Correct endpoint from main branch
        const body: { provider: string; model?: string; version?: string; session_id?: string } = { provider };
        if (model) { body.model = model; }
        if (version) { body.version = version; }
        if (sessionId) { body.session_id = sessionId; } // Add session_id from parameter

        const options: RequestInit = {
            method: 'POST',
            body: JSON.stringify(body)
        };

        try {
            const response = await this.request(path, options);

            // Handle potentially empty/non-JSON success responses (from main branch logic)
            try {
                const contentLength = response.headers.get('content-length');
                if (contentLength === '0') {
                    this.logger.info(`Agent provider/model updated successfully (Status ${response.status}, Content-Length: 0).`);
                    return { success: true };
                }
                // If Content-Length is not '0' or not present, attempt to parse JSON
                const responseData = await response.json();
                this.logger.info(`Agent provider/model updated (Status ${response.status}), response:`, responseData);
                return responseData;
            } catch (parseError) {
                this.logger.error(`Agent provider/model update request succeeded (Status ${response.status}), but failed to parse JSON response:`, parseError);
                const textBody = await response.text().catch(() => ""); // Attempt to get text body
                this.logger.error(`Response body text (if any): ${textBody}`);
                return { success: true, warning: "Response body was not valid JSON." };
            }
        } catch (error) {
            this.logger.error(`Failed to update agent provider/model for ${provider}:`, error);
            throw error; // Re-throw to allow caller to handle
        }
    }

    public async startAgent(workingDir: string): Promise<{ session_id: string }> {
        this.logger.info(`Starting agent with working directory: ${workingDir}`);
        const path = '/agent/start';
        const options: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ working_dir: workingDir })
        };

        try {
            const response = await this.request(path, options);
            const responseData = await response.json();
            this.logger.info(`Agent started successfully. Session ID: ${responseData.session_id}`);
            return { session_id: responseData.session_id };
        } catch (error) {
            this.logger.error(`Failed to start agent:`, error);
            throw error;
        }
    }

    public async setAgentPrompt(prompt: string, sessionId: string): Promise<any> {
        this.logger.info(`Setting agent system prompt for session ${sessionId}...`); 
        const path = '/agent/prompt';
        const trimmedPrompt = prompt.trim();

        if (trimmedPrompt === '') {
            this.logger.info('Trimmed system prompt is empty. Skipping API call to /agent/prompt.');
            return Promise.resolve(undefined);
        }

        const options: RequestInit = {
            method: 'POST',
            body: JSON.stringify({ extension: trimmedPrompt, session_id: sessionId }) // Include session_id
        };
        try {
            const response = await this.request(path, options);
            const responseData = await response.json(); // Assuming success returns JSON
            this.logger.info(`Agent prompt set successfully, response: ${JSON.stringify(responseData)}`); 
            return responseData; // Return the actual response data
        } catch (error) {
            this.logger.error(`API request to ${path} failed:`, error);
            // Re-throw the error so the test can catch it
            throw error; // Re-throw the original error from this.request
        }
    }

    public async addExtension(name: string, type: 'builtin' = 'builtin'): Promise<any> {
        this.logger.info(`Adding extension: ${name} (type: ${type})`);
        const path = '/extensions/add';
        const body = { type, name };
        const options: RequestInit = {
            method: 'POST',
            body: JSON.stringify(body)
        };
        try {
            const response = await this.request(path, options);
            const responseData = await response.json();
            this.logger.info(`Extension '${name}' added successfully. Response:`, responseData);
            return responseData;
        } catch (error) {
            this.logger.error(`Failed to add extension '${name}':`, error);
            throw error; // Re-throw to allow caller to handle
        }
    }

    public async streamChatResponse(params: StreamChatParams): Promise<Response> {
        const { prompt: messages, abortController, sessionId, workspaceDirectory } = params;
        // Always ensure we have a working directory
        const effectiveWorkingDir = workspaceDirectory || process.cwd();

        this.logger.info(`Streaming chat response with working dir: ${effectiveWorkingDir}, session: ${sessionId || 'new'}`);

        const path = "/reply";
        const options: RequestInit = {
            method: "POST",
            body: JSON.stringify({
                messages,
                session_id: sessionId,
                session_working_dir: effectiveWorkingDir,
            }),
            signal: abortController?.signal,
            headers: {
                Accept: "text/event-stream", // Crucial for streaming
                // Content-Type and X-Secret-Key are added by this.request
            },
            // IMPORTANT: Keepalive is often needed for long-running streams,
            // but node-fetch might handle this differently or it might not be needed for localhost.
            // If streams disconnect prematurely, consider adding: keepalive: true
        };

        // Use the base request method, which handles headers, logging, and basic error checking.
        // The response object itself will contain the stream.
        try {
            const response = await this.request(path, options);
            // The caller is responsible for reading the stream from response.body
            this.logger.info(`Stream request initiated successfully for ${path}`);
            return response;
        } catch (error) {
            this.logger.error(`Failed to initiate stream request to ${path}:`, error);
            throw error; // Re-throw to allow caller to handle
        }

        // --- Old Fake Response Logic Removed ---
        // async function* emptyGenerator(): AsyncIterable<Uint8Array> {}
    }

    // --- END: Stub methods ---

    /**
     * Make a request to the Goose API
     * @param path The API endpoint path
     * @param options Fetch options
     * @returns The fetch response
     */
    // ... rest of your code remains the same ...
}
