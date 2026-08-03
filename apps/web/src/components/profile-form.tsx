import { Button, Card, Checkbox, Cluster, Field, Input, Select, Stack, Textarea } from '@luma/ui';
import { alertFrequencySchema, type AlertProfile } from '@luma/domain';
import { ALERT_FREQUENCY_LABEL_NB } from '@/server/format';

/**
 * The alert profile form (spec section 11.1).
 *
 * One component for both creating and editing, so the two can never drift apart
 * on which criteria exist. Every control has a real `<label>` through `Field`,
 * and the hints explain what a field does in Norwegian rather than assuming
 * procurement vocabulary the user may not have.
 *
 * Lists are free text separated by commas or line breaks. That is a deliberate
 * choice over a tag widget: it works without JavaScript, it is pasteable from a
 * spreadsheet, and it degrades to something a screen reader can read back in
 * one go.
 */

export interface ProfileFormProps {
  /** Absent when creating. */
  readonly profile?: AlertProfile | null;
  /** Pre-filled values from an service template, used on the new-profile page. */
  readonly prefill?: {
    readonly name?: string;
    readonly cpvInclude?: readonly string[];
    readonly cpvExclude?: readonly string[];
    readonly keywordsInclude?: readonly string[];
    readonly keywordsExclude?: readonly string[];
    readonly serviceTemplateId?: string;
  };
  readonly action: (formData: FormData) => Promise<void>;
  readonly submitLabel: string;
}

export function ProfileForm({ profile, prefill, action, submitLabel }: ProfileFormProps) {
  const value = (
    fromProfile: readonly string[] | undefined,
    fromPrefill: readonly string[] | undefined,
  ) => (fromProfile && fromProfile.length > 0 ? fromProfile : (fromPrefill ?? [])).join('\n');

  return (
    <form action={action}>
      <Stack gap="lg">
        {profile ? <input type="hidden" name="profileId" value={profile.id} /> : null}
        {prefill?.serviceTemplateId ? (
          <input type="hidden" name="serviceTemplateId" value={prefill.serviceTemplateId} />
        ) : null}

        <Card as="section" heading="Navn og beskrivelse" titleLevel={2} tone="flat">
          <Stack gap="md">
            <Field id="name" label="Navn på profilen" required>
              {(control) => (
                <Input
                  {...control}
                  name="name"
                  maxLength={120}
                  defaultValue={profile?.name ?? prefill?.name ?? ''}
                />
              )}
            </Field>
            <Field
              id="description"
              label="Beskrivelse"
              hint="Valgfritt. Til deg selv, hvis du har flere profiler."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="description"
                  rows={3}
                  maxLength={2000}
                  defaultValue={profile?.description ?? ''}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Card as="section" heading="Hva skal med" titleLevel={2} tone="flat">
          <Stack gap="md">
            <Field
              id="cpvInclude"
              label="CPV-koder som skal med"
              hint="Åtte siffer per kode, én per linje. En overordnet kode tar med alle kodene under seg: 45000000 treffer også 45213316."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="cpvInclude"
                  rows={4}
                  defaultValue={value(profile?.cpvInclude, prefill?.cpvInclude)}
                />
              )}
            </Field>

            <Field
              id="keywordsInclude"
              label="Søkeord som skal med"
              hint="Ett per linje. Store og små bokstaver spiller ingen rolle, og æ, ø og å behandles likt som ae, oe og aa."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="keywordsInclude"
                  rows={4}
                  defaultValue={value(profile?.keywordsInclude, prefill?.keywordsInclude)}
                />
              )}
            </Field>

            <Field
              id="regionsInclude"
              label="Geografiske områder"
              hint="NUTS-koder, én per linje, for eksempel NO081. Kunngjøringer som gjelder hele landet kommer med uansett hva du fyller ut her."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="regionsInclude"
                  rows={3}
                  defaultValue={value(profile?.regionsInclude, undefined)}
                />
              )}
            </Field>

            <Field
              id="buyerInclude"
              label="Oppdragsgivere du særlig følger"
              hint="Valgfritt. Ett navn per linje. La feltet stå tomt for å få treff fra alle oppdragsgivere."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="buyerInclude"
                  rows={3}
                  defaultValue={value(profile?.buyerInclude, undefined)}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Card as="section" heading="Hva skal holdes utenfor" titleLevel={2} tone="flat">
          <Stack gap="md">
            <p className="prose-measure m-0 text-sm text-text-muted">
              Eksklusjoner overstyrer alltid inklusjoner. Treffer en kunngjøring både et søkeord du
              vil ha og et du vil unngå, holdes den utenfor — og du kan se hvorfor på
              anbudsdetaljsiden.
            </p>
            <Field id="cpvExclude" label="CPV-koder som skal holdes utenfor">
              {(control) => (
                <Textarea
                  {...control}
                  name="cpvExclude"
                  rows={3}
                  defaultValue={value(profile?.cpvExclude, prefill?.cpvExclude)}
                />
              )}
            </Field>
            <Field id="keywordsExclude" label="Søkeord som skal holdes utenfor">
              {(control) => (
                <Textarea
                  {...control}
                  name="keywordsExclude"
                  rows={3}
                  defaultValue={value(profile?.keywordsExclude, prefill?.keywordsExclude)}
                />
              )}
            </Field>
            <Field id="buyerExclude" label="Oppdragsgivere som skal holdes utenfor">
              {(control) => (
                <Textarea
                  {...control}
                  name="buyerExclude"
                  rows={3}
                  defaultValue={value(profile?.buyerExclude, undefined)}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Card as="section" heading="Størrelse og konkurransetype" titleLevel={2} tone="flat">
          <Stack gap="md">
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <Field
                id="estimatedValueMinNok"
                label="Laveste anslåtte verdi"
                hint="I kroner. La stå tomt hvis størrelsen ikke betyr noe."
              >
                {(control) => (
                  <Input
                    {...control}
                    name="estimatedValueMinNok"
                    inputMode="numeric"
                    defaultValue={profile?.estimatedValueMinNok ?? ''}
                  />
                )}
              </Field>
              <Field id="estimatedValueMaxNok" label="Høyeste anslåtte verdi" hint="I kroner.">
                {(control) => (
                  <Input
                    {...control}
                    name="estimatedValueMaxNok"
                    inputMode="numeric"
                    defaultValue={profile?.estimatedValueMaxNok ?? ''}
                  />
                )}
              </Field>
            </div>

            <p className="prose-measure m-0 text-sm text-text-muted">
              Omtrent halvparten av kunngjøringene på Doffin oppgir ingen verdi, og verdien er ikke
              alltid i kroner. Kunngjøringer uten oppgitt verdi holdes ikke utenfor av dette
              filteret — de behandles som ukjent størrelse, ikke som null kroner.
            </p>

            <Field
              id="deadlineMinimumDays"
              label="Minste antall dager til frist"
              hint="Valgfritt. Filtrerer bort konkurranser der det er for kort tid igjen til å rekke et tilbud."
            >
              {(control) => (
                <Input
                  {...control}
                  name="deadlineMinimumDays"
                  inputMode="numeric"
                  defaultValue={profile?.deadlineMinimumDays ?? ''}
                />
              )}
            </Field>

            <Checkbox
              name="includePlannedProcurements"
              defaultChecked={profile?.includePlannedProcurements ?? true}
              label="Ta med planlagte anskaffelser (veiledende kunngjøringer og intensjonskunngjøringer)"
            />
          </Stack>
        </Card>

        <Card as="section" heading="Varsling" titleLevel={2} tone="flat">
          <Stack gap="md">
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <Field id="frequency" label="Hvor ofte vil du ha varsler?" required>
                {(control) => (
                  <Select
                    {...control}
                    name="frequency"
                    defaultValue={profile?.frequency ?? 'daily'}
                  >
                    {alertFrequencySchema.options.map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {ALERT_FREQUENCY_LABEL_NB[frequency]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                id="digestHourLocal"
                label="Når på dagen"
                hint="Norsk tid. Gjelder daglig og ukentlig sammendrag."
              >
                {(control) => (
                  <Select
                    {...control}
                    name="digestHourLocal"
                    defaultValue={String(profile?.digestHourLocal ?? 7)}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={String(hour)}>
                        {`${String(hour).padStart(2, '0')}:00`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field
              id="minimumMatchScore"
              label="Minste treffscore"
              hint="0 til 100. Høyere tall gir færre og mer presise treff. Treffscoren sier hvor godt anbudet passer profilen, ikke hvor sannsynlig det er å vinne."
            >
              {(control) => (
                <Input
                  {...control}
                  name="minimumMatchScore"
                  inputMode="numeric"
                  defaultValue={String(profile?.minimumMatchScore ?? 0)}
                />
              )}
            </Field>
          </Stack>
        </Card>

        <Cluster gap="xs">
          <Button type="submit" variant="primary">
            {submitLabel}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
