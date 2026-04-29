import vhtml from 'vhtml';

/** @jsx vhtml */

export function ValidatorTable({ title, color, messages }) {
	const count = messages.length;
	const headingId = `report-section-${title.toLowerCase()}`;
	return (
		<section class="report-section" aria-labelledby={headingId}>
			<h2 id={headingId} class="report-section-heading" style={`border-left-color: ${color}`}>
				{title}
				{count > 1 ? 's' : ''} <span class="report-count">({count})</span>
			</h2>
			<div class="report-table-wrap">
				<table class="report-table" aria-label={`${title} issues`}>
					<thead>
						<tr style={`background: ${color}`}>
							<th scope="col">Code</th>
							<th scope="col">Message</th>
							<th scope="col">Pointer</th>
						</tr>
					</thead>
					<tbody>
						{messages.map(({ code, message, pointer }) => {
							return (
								<tr>
									<td>
										<code>{code}</code>
									</td>
									<td>{message}</td>
									<td>
										<code>{pointer || '\u2014'}</code>
									</td>
								</tr>
							);
						})}
						{messages.length === 0 && (
							<tr>
								<td colspan="3">No issues found.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
