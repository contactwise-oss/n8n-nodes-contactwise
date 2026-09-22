import nock from 'nock';
import { afterEach, beforeEach } from 'vitest';

// There is no ContactWise sandbox: any request that reaches the real API sends a real,
// billed SMS. Every test runs with the network closed; only nock interceptors answer.
beforeEach(() => {
	nock.disableNetConnect();
});

afterEach(() => {
	nock.cleanAll();
	nock.enableNetConnect();
});
