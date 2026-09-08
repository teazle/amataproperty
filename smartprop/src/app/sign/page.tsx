import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-16">
      <div className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-2xl items-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Co-broking Agreement</CardTitle>
            <CardDescription>Public agreement signing is currently unavailable.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Please contact the property team to arrange a secure signing process.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
