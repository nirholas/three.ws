import { useAppStore } from '@shared/stores/appStore'
import { Section, Card, Row, Toggle } from '@shared/ui'

export function ApplicationSection(): JSX.Element {
  const { showRamIndicator, setShowRamIndicator } = useAppStore()

  return (
    <Section title="Application" subtitle="General application settings.">
      <Card title="Interface">
        <Row
          label="RAM indicator"
          description="Show live memory usage in the top bar."
        >
          <Toggle value={showRamIndicator} onChange={setShowRamIndicator} />
        </Row>
      </Card>
    </Section>
  )
}
