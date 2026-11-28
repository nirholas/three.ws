// A small product catalog base for the TestDriver: one table with a prompt per record
// and every field type the extension maps. Record "recLamp" already has a model.
import { FieldType, ViewType } from '@airtable/blocks/models';

const field = (id, name, type, options = null) => ({ id, name, description: '', type, options });
const fieldIds = ['fldName', 'fldPrompt', 'fldModel', 'fldPage', 'fldStatus', 'fldPrice'];

export const LAMP_GLB = 'https://three.ws/cdn/forge/7538fb22fd50/420980dd-1c07-4830-b0db-0eacd12cf6de.glb';

export default {
	base: {
		id: 'appForgeCatalog1',
		name: 'Product catalog',
		tables: [
			{
				id: 'tblProducts',
				name: 'Products',
				description: '',
				fields: [
					field('fldName', 'Name', FieldType.SINGLE_LINE_TEXT),
					field('fldPrompt', 'Prompt', FieldType.MULTILINE_TEXT),
					field('fldModel', 'Model', FieldType.MULTIPLE_ATTACHMENTS, { isReversed: false }),
					field('fldPage', '3D page', FieldType.URL),
					field('fldStatus', 'Status', FieldType.SINGLE_LINE_TEXT),
					field('fldPrice', 'Price', FieldType.NUMBER, { precision: 2 }),
				],
				views: [
					{
						id: 'viwAll',
						name: 'All products',
						type: ViewType.GRID,
						fieldOrder: { fieldIds, visibleFieldCount: fieldIds.length },
						records: ['recTeapot', 'recLamp', 'recBlank', 'recShort'].map((id) => ({ id, color: null })),
					},
				],
				records: [
					{
						id: 'recTeapot',
						commentCount: 0,
						createdTime: '2026-11-28T07:00:00.000Z',
						cellValuesByFieldId: { fldName: 'Teapot', fldPrompt: 'a ceramic teapot with a bamboo handle' },
					},
					{
						id: 'recLamp',
						commentCount: 0,
						createdTime: '2026-11-28T07:00:01.000Z',
						cellValuesByFieldId: {
							fldName: 'Desk lamp',
							fldPrompt: 'a brass desk lamp with a green glass shade',
							fldModel: [{ id: 'attLamp', url: LAMP_GLB, filename: 'lamp.glb', size: 1172500, type: 'model/gltf-binary' }],
						},
					},
					{ id: 'recBlank', commentCount: 0, createdTime: '2026-11-28T07:00:02.000Z', cellValuesByFieldId: { fldName: 'Untitled' } },
					{ id: 'recShort', commentCount: 0, createdTime: '2026-11-28T07:00:03.000Z', cellValuesByFieldId: { fldName: 'Short', fldPrompt: 'ab' } },
				],
			},
		],
		collaborators: [
			{ id: 'usrEditor', name: 'Catalog Editor', email: 'editor@example.test', profilePicUrl: null, isActive: true },
		],
	},
};
