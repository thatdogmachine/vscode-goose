import * as assert from 'assert'; // Use Node's built-in assert
import { ApiClient, ApiClientConfig } from '../../server/apiClient';
import sinon from 'sinon';
import { Logger } from '../../utils/logger'; // Import Logger class for stubbing

// Mock the global fetch function
const mockFetch = sinon.stub();
global.fetch = mockFetch as any;

suite('ApiClient Tests', () => { // Changed describe to suite
    let apiClient: ApiClient;
    let config: ApiClientConfig;
    let mockLogger: sinon.SinonStubbedInstance<Logger>; // Stub the Logger class

    setup(() => { // Changed beforeEach to setup
        // Reset stubs before each test
        mockFetch.reset();
        mockLogger = sinon.createStubInstance(Logger); // Create a stub instance of the Logger class
        mockLogger.createSource.returnsThis(); // Make createSource return the stub for chaining

        config = {
            baseUrl: 'http://localhost:1234',
            secretKey: 'test-secret-key',
            logger: mockLogger,
            debug: false, // Set to true for more verbose logging during debugging tests
        };
        apiClient = new ApiClient(config);
    });

    teardown(() => { // Changed afterEach to teardown
        sinon.restore(); // Restore original functions after each test
    });

    suite('setAgentPrompt', () => { // Changed describe to suite
        const promptText = 'Test system prompt';
        const expectedPath = '/agent/prompt';
        const expectedMethod = 'POST';
        const expectedBody = JSON.stringify({ extension: promptText });
        // Define expectedHeaders inside the test where config is guaranteed to be set

        test('should call fetch with correct arguments and return success response', async () => { // Changed it to test
            // Define expectedHeaders here, inside the test block
            const expectedHeaders = {
                'Content-Type': 'application/json',
                'X-Secret-Key': config.secretKey,
            };
            const mockSuccessResponse = { success: true };
            mockFetch.resolves({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: sinon.stub().resolves(mockSuccessResponse),
                text: sinon.stub().resolves(JSON.stringify(mockSuccessResponse)), // Add text stub
                headers: new Headers(), // Add headers stub
            });

            const result = await apiClient.setAgentPrompt(promptText, "test-session-id");

            assert.ok(mockFetch.calledOnce, 'fetch should be called once');
            const [url, options] = mockFetch.getCall(0).args;
            assert.strictEqual(url, `${config.baseUrl}${expectedPath}`, 'URL should match');
            assert.strictEqual(options.method, expectedMethod, 'Method should be POST');
            assert.deepStrictEqual(options.headers, expectedHeaders, 'Headers should match');
            assert.strictEqual(options.body, expectedBody, 'Body should match');
            assert.deepStrictEqual(result, mockSuccessResponse, 'Result should match mock response');
            assert.ok(mockLogger.info.calledWith(`Setting agent system prompt...`), 'Info log for setting prompt missing');
            assert.ok(mockLogger.info.calledWith(`Agent prompt set successfully, response: ${JSON.stringify(mockSuccessResponse)}`), 'Info log for success missing');
        });

        test('should trim prompt with leading/trailing whitespace', async () => {
            const inputPrompt = '  Trimmed Test Prompt  ';
            const expectedTrimmedPrompt = 'Trimmed Test Prompt';
            const expectedBody = JSON.stringify({ extension: expectedTrimmedPrompt });
            const mockSuccessResponse = { success: true };

            mockFetch.resolves({
                ok: true, status: 200, statusText: 'OK',
                json: sinon.stub().resolves(mockSuccessResponse),
                text: sinon.stub().resolves(JSON.stringify(mockSuccessResponse)),
                headers: new Headers(),
            });

            await apiClient.setAgentPrompt(inputPrompt, "test-session-id");

            assert.ok(mockFetch.calledOnce, 'fetch should be called once');
            const [, options] = mockFetch.getCall(0).args;
            assert.strictEqual(options.body, expectedBody, 'Body should contain trimmed prompt');
            assert.ok(mockLogger.info.calledWith(`Setting agent system prompt...`), 'Initial info log missing');
        });

        test('should skip API call for an empty string prompt', async () => {
            const inputPrompt = '';
            const result = await apiClient.setAgentPrompt(inputPrompt, "test-session-id");

            assert.strictEqual(mockFetch.notCalled, true, 'fetch should not be called for empty prompt');
            assert.strictEqual(result, undefined, 'Should return undefined for skipped call');
            assert.ok(mockLogger.info.calledWith(`Setting agent system prompt...`), 'Initial info log missing');
            assert.ok(mockLogger.info.calledWith('Trimmed system prompt is empty. Skipping API call to /agent/prompt.'), 'Skip log missing');
        });

        test('should skip API call for a whitespace-only prompt', async () => {
            const inputPrompt = '   '; // Whitespace only
            const result = await apiClient.setAgentPrompt(inputPrompt, "test-session-id");

            assert.strictEqual(mockFetch.notCalled, true, 'fetch should not be called for whitespace-only prompt');
            assert.strictEqual(result, undefined, 'Should return undefined for skipped call');
            assert.ok(mockLogger.info.calledWith(`Setting agent system prompt...`), 'Initial info log missing');
            assert.ok(mockLogger.info.calledWith('Trimmed system prompt is empty. Skipping API call to /agent/prompt.'), 'Skip log missing for whitespace');
        });

        test('should throw an error if the API request fails', async () => { // Changed it to test
            // Define expectedHeaders here, inside the test block
            const expectedHeaders = {
                'Content-Type': 'application/json',
                'X-Secret-Key': config.secretKey,
            };
            const mockErrorResponse = 'Internal Server Error';
            const mockStatus = 500;
            const mockStatusText = 'Server Error';
            mockFetch.resolves({
                ok: false,
                status: mockStatus,
                statusText: mockStatusText,
                json: sinon.stub().rejects(new Error('Should not call json() on error')), // Should not be called
                text: sinon.stub().resolves(mockErrorResponse), // text() is called for error body
                headers: new Headers(), // Add headers stub
            });

            await assert.rejects(
                async () => {
                    await apiClient.setAgentPrompt(promptText, "test-session-id");
                },
                (error: any) => {
                    assert.ok(mockFetch.calledOnce, 'fetch should be called once on error');
                    const [url, options] = mockFetch.getCall(0).args;
                    assert.strictEqual(url, `${config.baseUrl}${expectedPath}`);
                    assert.strictEqual(options.method, expectedMethod);
                    assert.deepStrictEqual(options.headers, expectedHeaders);
                    assert.strictEqual(options.body, expectedBody);
                    assert.ok(error instanceof Error, 'Error should be an instance of Error');
                    assert.ok(
                        error.message.includes(`API request failed: ${mockStatus} ${mockStatusText} - ${mockErrorResponse}`),
                        `Error message mismatch: ${error.message}`
                    );
                    assert.ok(mockLogger.error.calledWith(`API request to ${expectedPath} failed:`), 'Error log missing');
                    return true; // Indicate the error is expected
                },
                'Expected setAgentPrompt to throw an error'
            );
        });
    });

    // Add other tests for ApiClient methods here...
});
