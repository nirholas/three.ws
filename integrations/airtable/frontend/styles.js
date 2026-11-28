// The few styles the Airtable UI kit has no prop for: the record title button that
// opens the record (hover and keyboard focus states included).
export const STYLES = `
.forge-record-link {
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	text-align: left;
	background: none;
	border: 0;
	padding: 0;
	margin: 0;
	cursor: pointer;
	font: inherit;
	font-size: 13px;
	line-height: 1.4;
	color: hsl(0, 0%, 20%);
	border-radius: 3px;
}
.forge-record-link:hover { color: hsl(212, 92%, 45%); text-decoration: underline; }
.forge-record-link:active { color: hsl(212, 92%, 35%); }
.forge-record-link:focus-visible { outline: 2px solid hsl(212, 92%, 45%); outline-offset: 2px; }
`;
