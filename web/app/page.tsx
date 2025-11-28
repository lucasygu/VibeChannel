import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Github, FileText } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Hero Section */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 text-5xl font-bold">
              <MessageSquare className="w-12 h-12" />
              <h1>VibeChannel</h1>
            </div>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              A filesystem-based conversation protocol where folders of markdown files render as chat interfaces
            </p>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <FileText className="w-8 h-8 mb-2 text-primary" />
                <CardTitle className="text-lg">File-Based</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Each message is an atomic markdown file with frontmatter metadata
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Github className="w-8 h-8 mb-2 text-primary" />
                <CardTitle className="text-lg">Git-Friendly</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Version control conversations with standard git workflows
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <MessageSquare className="w-8 h-8 mb-2 text-primary" />
                <CardTitle className="text-lg">Portable</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Conversations are just folders - portable and platform-independent
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* CTA */}
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Get Started</CardTitle>
              <CardDescription>
                Install the VSCode extension to start using VibeChannel
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <Button asChild size="lg">
                  <a
                    href="https://marketplace.visualstudio.com/items?itemName=lucasygu.vibechannel"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Install Extension
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a
                    href="https://github.com/lucasygu/VibeChannel"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github className="w-4 h-4 mr-2" />
                    View on GitHub
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="text-center text-sm text-muted-foreground">
            <p>Open source • Decentralized • Developer-friendly</p>
          </div>
        </div>
      </div>
    </main>
  );
}
