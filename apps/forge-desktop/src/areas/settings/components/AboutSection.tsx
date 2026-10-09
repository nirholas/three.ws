import { useEffect, useState } from 'react'
import { Section, Card, Row, LinkButton } from '@shared/ui'

export function AboutSection(): JSX.Element {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    window.electron.app.info().then(({ version }) => setVersion(version))
  }, [])

  return (
    <Section title="About" subtitle="Application information and useful resources.">
      <div className="grid grid-cols-2 gap-4">

        <Card>
          <Row label="three.ws Forge" description="3D generation on your machine or the three.ws cloud.">
            <span className="text-xs font-mono text-zinc-400">{version ? `v${version}` : '-'}</span>
          </Row>
          <Row label="Documentation" description="Guides, extensions and the local API.">
            <LinkButton label="Open" href="https://three.ws/docs/forge-desktop" />
          </Row>
          <Row label="Downloads" description="Every release for macOS, Windows and Linux.">
            <LinkButton label="Open" href="https://three.ws/forge-desktop" />
          </Row>
          <Row label="Source code" description="Source and issues for three.ws Forge.">
            <LinkButton label="Open" href="https://github.com/nirholas/three.ws/tree/main/apps/forge-desktop" />
          </Row>
        </Card>

        <Card>
          <Row label="Telegram" description="Community, release notes and support.">
            <LinkButton label="Join" href="https://t.me/three_ws" />
          </Row>
          <Row label="X" description="Follow @trythreews for updates.">
            <LinkButton label="Follow" href="https://x.com/trythreews" />
          </Row>
          <Row label="Based on Modly" description="Built on the MIT-licensed Modly by Lightning Pixel.">
            <LinkButton label="View" href="https://github.com/lightningpixel/modly" />
          </Row>
          <Row label="Licenses" description="MIT license and third-party notices.">
            <LinkButton label="View" href="https://github.com/nirholas/three.ws/blob/main/apps/forge-desktop/NOTICE" />
          </Row>
        </Card>

      </div>
    </Section>
  )
}
