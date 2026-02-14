import { VideoEditor } from "../../../components/video-editor";

export default function VideoEditorPage({
  params,
}: {
  params: {
    id: string;
  };
}) {
  return (
    <main>
      <VideoEditor videoId={params.id} />
    </main>
  );
}
