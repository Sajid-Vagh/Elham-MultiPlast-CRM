import { useListDuplicateContacts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Phone, Mail, AlertTriangle } from "lucide-react";

export default function Duplicates() {
  const { data: groups, isLoading } = useListDuplicateContacts();

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Duplicate Detection</h1>
        <p className="text-muted-foreground mt-1">
          Contacts sharing the same mobile or email assigned to different sales owners
        </p>
      </div>

      {groups?.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-50 mb-4">
              <AlertTriangle className="h-6 w-6 text-green-500" />
            </div>
            <p className="font-medium">No duplicates found</p>
            <p className="text-sm text-muted-foreground mt-1">All contacts have unique mobile and email addresses per owner.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {groups?.map((group, i) => (
          <Card key={i} className="border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>Duplicate {group.field === "mobile" ? "Mobile" : "Email"}: </span>
                <code className="text-sm bg-muted px-2 py-0.5 rounded font-mono">{group.value}</code>
                <Badge variant="outline" className="ml-auto border-amber-300 text-amber-700 bg-amber-50">
                  {group.contacts.length} contacts
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {group.contacts.map(contact => (
                  <div key={contact.id} className="flex items-start gap-3 p-3 border rounded-md bg-card">
                    <div className="flex-shrink-0">
                      {contact.salesOwner ? (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: contact.salesOwner.colorCode }}>
                          {contact.salesOwner.name.charAt(0)}
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link href={`/leads/${contact.id}`} className="font-medium hover:underline text-primary text-sm">
                        {contact.name}
                      </Link>
                      {contact.companyName && <p className="text-xs text-muted-foreground truncate">{contact.companyName}</p>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{contact.mobile}</span>
                        {contact.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{contact.email}</span>}
                      </div>
                      {contact.salesOwner && (
                        <p className="text-xs mt-1">
                          <span className="text-muted-foreground">Owner: </span>
                          <span className="font-medium">{contact.salesOwner.name}</span>
                          {contact.salesOwner.unit && <span className="text-muted-foreground"> ({contact.salesOwner.unit})</span>}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
