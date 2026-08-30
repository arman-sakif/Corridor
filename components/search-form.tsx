'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Route } from 'next';

import { Button, Select, Input } from '@/components/ui';
import { IconCalendar, IconPin, IconSearch, IconSwap, IconWarning } from '@/components/icons';
import { addDays, todayInToronto } from '@/lib/time';

type City = { id: string; name: string };

/**
 * City pair plus a date, laid out as one connected control rather than three
 * separate fields — the two cities read as the ends of a journey, with the
 * swap sitting on the line between them.
 *
 * A GET navigation rather than a Server Action, so the result is a shareable,
 * back-button-friendly URL.
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

    setError(null);
    router.push(`/search?from=${from}&to=${to}&date=${date}` as Route);
  }

  const swap = () => {
    setError(null);
    setFrom(to);
    setTo(from);
  };

  const cityOptions = cities.map((city) => (
    <option key={city.id} value={city.id}>
      {city.name}
    </option>
  ));

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl bg-white p-3 shadow-hero ring-1 ring-ink-200/70 sm:p-4"
    >
      <div className="relative grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-ink-50 px-3.5 py-2.5 ring-1 ring-ink-200 focus-within:ring-2 focus-within:ring-brand-500">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
            <IconPin className="text-sm" />
            Leaving from
          </span>
          <Select
            aria-label="Leaving from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-0.5 h-7 border-0 bg-transparent px-0 text-base font-medium text-ink-900 ring-0 focus:ring-0"
          >
            <option value="">Choose a city</option>
            {cityOptions}
          </Select>
        </div>

        <div className="rounded-xl bg-ink-50 px-3.5 py-2.5 ring-1 ring-ink-200 focus-within:ring-2 focus-within:ring-brand-500">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
            <IconPin className="text-sm" />
            Going to
          </span>
          <Select
            aria-label="Going to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-0.5 h-7 border-0 bg-transparent px-0 text-base font-medium text-ink-900 ring-0 focus:ring-0"
          >
            <option value="">Choose a city</option>
            {cityOptions}
          </Select>
        </div>

        {/* Sits on the seam between the two cities on desktop. */}
        <button
          type="button"
          onClick={swap}
          aria-label="Swap the two cities"
          className="absolute top-1/2 left-1/2 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-ink-500 shadow-card ring-1 ring-ink-200 transition-colors hover:text-brand-600 hover:ring-brand-300 sm:flex"
        >
          <IconSwap className="rotate-90 text-sm" />
        </button>
      </div>

      <button
        type="button"
        onClick={swap}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 hover:text-brand-600 sm:hidden"
      >
        <IconSwap className="text-sm" />
        Swap
      </button>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="rounded-xl bg-ink-50 px-3.5 py-2.5 ring-1 ring-ink-200 focus-within:ring-2 focus-within:ring-brand-500">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
            <IconCalendar className="text-sm" />
            Travelling on
          </span>
          <Input
            type="date"
            aria-label="Date of travel"
            value={date}
            min={today}
            max={addDays(today, 60)}
            onChange={(e) => setDate(e.target.value)}
            className="numeric mt-0.5 h-7 border-0 bg-transparent px-0 text-base font-medium text-ink-900 ring-0 focus:ring-0"
          />
        </div>

        <Button type="submit" size="lg" className="w-full sm:w-auto sm:px-8">
          <IconSearch />
          Search rides
        </Button>
      </div>

      {error ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-bad-700">
          <IconWarning className="shrink-0" />
          {error}
        </p>
      ) : null}

      {cities.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">No cities are listed yet. Check back shortly.</p>
      ) : null}
    </form>
  );
}
