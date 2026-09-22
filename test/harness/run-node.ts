import { ExecutionLifecycleHooks, WorkflowExecute } from 'n8n-core';
import { NodeHelpers, Workflow, createRunExecutionData } from 'n8n-workflow';
import type {
	ExecutionBaseError,
	ICredentialDataDecryptedObject,
	ICredentialType,
	IDataObject,
	INode,
	INodeExecutionData,
	INodeParameters,
	INodeType,
	INodeTypes,
	IRun,
	IWorkflowExecuteAdditionalData,
} from 'n8n-workflow';
import { mock } from 'vitest-mock-extended';

import { TestCredentialsHelper } from './credentials-helper';

export const PACKAGE_NAME = 'n8n-nodes-contactwise';

export interface RunNodeOptions {
	/** Node class instance under test, e.g. `new ContactWiseSms()`. */
	node: INodeType;
	parameters: INodeParameters;
	/** Credential class instances the node may use. */
	credentialTypes?: ICredentialType[];
	/** Decrypted credential values, keyed by credential type name. */
	credentials?: Record<string, ICredentialDataDecryptedObject>;
	/** JSON of the items fed into the node. Defaults to one empty item. */
	input?: IDataObject[];
	/** Mirrors the node setting "On Error: Continue". */
	continueOnFail?: boolean;
	typeVersion?: number;
}

export interface RunNodeResult {
	/** Items on the node's first main output (empty when the node failed). */
	items: INodeExecutionData[];
	/** Set when the node failed and stopped the workflow. */
	error?: ExecutionBaseError;
	run: IRun;
}

const NODE_NAME = 'Node Under Test';

/**
 * Executes one node inside n8n's real execution engine (n8n-core `WorkflowExecute`),
 * with credentials served from memory. HTTP must be faked with nock; the network is closed.
 */
export async function runNode(options: RunNodeOptions): Promise<RunNodeResult> {
	const { node: nodeType, credentialTypes = [], credentials = {} } = options;
	const typeName = `${PACKAGE_NAME}.${nodeType.description.name}`;
	const typeVersion =
		options.typeVersion ??
		(Array.isArray(nodeType.description.version)
			? Math.max(...nodeType.description.version)
			: nodeType.description.version);

	const nodeTypes: INodeTypes = {
		getByName: () => nodeType,
		getByNameAndVersion: (_type, version) => NodeHelpers.getVersionedNodeType(nodeType, version),
		getKnownTypes: () => ({}),
	};

	const node: INode = {
		id: 'node-under-test',
		name: NODE_NAME,
		type: typeName,
		typeVersion,
		position: [0, 0],
		parameters: options.parameters,
		credentials: Object.fromEntries(
			Object.keys(credentials).map((type) => [type, { id: `${type}-id`, name: `${type} account` }]),
		),
		...(options.continueOnFail && { onError: 'continueRegularOutput' as const }),
	};

	const workflow = new Workflow({
		id: 'test-workflow',
		nodes: [node],
		connections: {},
		nodeTypes,
		active: false,
		settings: {},
	});

	const hooks = new ExecutionLifecycleHooks('manual', 'test-execution', mock());
	let finalRun: IRun | undefined;
	hooks.addHandler('workflowExecuteAfter', (run) => {
		finalRun = run;
	});

	// Same shape n8n's own NodeTestHarness uses. Fields auto-mocked by the proxy are truthy
	// functions, so optional hooks n8n-core checks for are explicitly set to undefined.
	const additionalData = mock<IWorkflowExecuteAdditionalData>();
	Object.assign(additionalData, {
		executionId: 'test-execution',
		webhookWaitingBaseUrl: 'http://localhost/waiting-webhook',
		formWaitingBaseUrl: 'http://localhost/waiting-form',
		hooks,
		currentNodeParameters: undefined,
		parentCallbackManager: undefined,
		ssrfBridge: undefined,
		encryptedRunnerIdentity: undefined,
		evalLlmMockHandler: undefined,
		credentialsHelper: new TestCredentialsHelper(
			new Map(credentialTypes.map((type) => [type.name, type])),
			credentials,
		),
	});

	const input = (options.input ?? [{}]).map((json) => ({ json }));
	const runExecutionData = createRunExecutionData({
		executionData: {
			waitingExecutionSource: null,
			nodeExecutionStack: [{ node, data: { main: [input] }, source: null }],
		},
	});

	const returned = await new WorkflowExecute(
		additionalData,
		'manual',
		runExecutionData,
	).processRunExecutionData(workflow);
	const run = finalRun ?? returned;

	const taskData = run.data.resultData.runData[NODE_NAME]?.[0];
	return {
		items: taskData?.data?.main?.[0] ?? [],
		error: taskData?.error ?? run.data.resultData.error,
		run,
	};
}
