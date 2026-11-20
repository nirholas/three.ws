import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ThreeWsApi implements ICredentialType {
	name = 'threeWsApi';

	displayName = 'three.ws API';

	icon: Icon = { light: 'file:../nodes/ThreeWs/threews.svg', dark: 'file:../nodes/ThreeWs/threews.dark.svg' };

	documentationUrl = 'https://github.com/nirholas/three.ws/tree/main/integrations/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'A three.ws API key. Making a 3D model needs a free three.ws account; create a key at https://three.ws/dashboard/api-keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
	};

	// The studio answers HTTP 401 at the transport for a bearer that does not
	// verify, so listing its tools proves the key belongs to a real account.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://three.ws',
			url: '/api/mcp-studio',
			method: 'POST',
			headers: { accept: 'application/json, text/event-stream' },
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
		},
	};
}
