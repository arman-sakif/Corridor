'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, Select, Input } from '@/components/ui';
import { addDays, todayInToronto } from '@/lib/time';

type City = { id: string; name: string };

/**
 * City pair plus a date. A GET navigation rather than a Server Action, so the
 * result is a shareable, back-button-friendly URL.
 */
export function SearchForm({
  cities,
  defaults,
}: {
  cities: City[];
  defaults: { from: string; to: string; date: string };
}) {
  const router = useRouter();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [date, setDate] = useState(defaults.date || todayInToronto());
  const [error, setError] = useState<string | null>(null);

  const today = todayInToronto();

  function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!from || !to) {
      setError('Choose the city you are leaving from and the one you are going to.');
      return;
    }
    if (from === to) {
      setError('Those are the same city. Choose a different destination.');
      return;
    }

    router.push(`/search?from=${from}&to=${to}&date=${date}`);
  }

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <form onSubmit={submit} className="rounded-xl bg-white p-4 ring-1 ring-ink-200 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="From">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a city</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="To">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a city</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <Button
            type="button"
            tone="secondary"
            onClick={swap}
            aria-label="Swap the two cities"
            className="w-full sm:w-auto"
          >
            Swap
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Date">
          <Input
            type="date"
            value={date}
            min={today}
            max={addDays(today, 60)}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Search rides
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-bad-700">{error}</p> : null}

      {cities.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">
          No cities are listed yet. Check back shortly.
        </p>
      ) : null}
    </form>
  );
}
